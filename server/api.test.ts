// End-to-end API tests against a real (in-memory) D1 database via wrangler's platform proxy.
import { readdirSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { handle, type Env } from "./api";

const ORIGIN = "http://forge.test";
let env: Env;
let dispose: () => Promise<void>;

beforeAll(async () => {
  const proxy = await getPlatformProxy<Env>({ persist: false });
  env = { ...proxy.env, DEV_MAIL_OUTBOX: "1" };
  dispose = proxy.dispose;
  const dir = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const statements = readFileSync(new URL(file, dir), "utf8")
      .replace(/--.*$/gm, "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) await env.DB.prepare(stmt).run();
  }
});

afterAll(() => dispose?.());

let ipCounter = 0;

/** Minimal client; each gets its own IP so rate limits don't interfere. */
function client(ip = `10.0.0.${++ipCounter}`) {
  let cookie = "";
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, target: Env = env) => {
    const res = await handle(
      new Request(`${ORIGIN}/api${path}`, {
        method,
        headers: {
          Origin: ORIGIN,
          "CF-Connecting-IP": ip,
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
      target,
    );
    const set = res.headers.get("Set-Cookie");
    if (set) cookie = set.split(";")[0];
    return { status: res.status, data: (await res.json()) as any, setCookie: set };
  };
  return call;
}

describe("dev outbox", () => {
  it("is only reachable when enabled", async () => {
    expect((await client()("GET", "/dev/outbox")).status).toBe(200);
    const off = { ...env, DEV_MAIL_OUTBOX: undefined };
    const res = await handle(new Request(`${ORIGIN}/api/dev/outbox`), off);
    expect(res.status).toBe(404);
  });
});

describe("bug reports", () => {
  it("accepts reports from anyone, keeps only the documented context and ignores bots", async () => {
    const visitor = client();
    const report = (over: Record<string, unknown> = {}) =>
      visitor("POST", "/feedback", {
        kind: "bug",
        message: "The recipe tooltip covers the whole screen on my phone.",
        email: "",
        page: "/professions/alchemy",
        context: { browser: "TestBrowser/1.0", screen: "375×812", build: "1.60.1.70094", extra: "dropped" },
        website: "",
        ...over,
      });
    expect((await report()).status).toBe(201);
    expect((await report({ message: "short" })).status).toBe(400);
    expect((await report({ kind: "rant" })).status).toBe(400);
    expect((await report({ email: "not-an-email" })).status).toBe(400);
    expect((await report({ page: "https://evil.example/" })).status).toBe(400);
    // Honeypot filled: looks fine to the bot, nothing stored.
    expect((await report({ website: "http://spam.example", message: "Buy cheap gold now at our amazing site!!!" })).status).toBe(200);

    const { results } = await env.DB.prepare("SELECT message, context FROM feedback WHERE page = ?").bind("/professions/alchemy").all<{ message: string; context: string }>();
    expect(results).toHaveLength(1);
    expect(JSON.parse(results[0].context)).toEqual({ browser: "TestBrowser/1.0", screen: "375×812", build: "1.60.1.70094" });
  });

  it("refuses cross-origin posts", async () => {
    const res = await client()("POST", "/feedback", { kind: "bug", message: "Cross-origin report attempt." }, { Origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });
});

describe("recipe source reports", () => {
  it("stores reports as pending, shows them only after a signed approval, and merges duplicates", async () => {
    const { signReport } = await import("./routes/sources");
    const withSecret: Env = { ...env, REPORT_SECRET: "report-secret" };
    const call = async (method: string, path: string, body?: unknown, target: Env = withSecret, ip = `10.1.0.${++ipCounter}`) => {
      const res = await handle(
        new Request(`${ORIGIN}/api${path}`, {
          method,
          headers: { Origin: ORIGIN, "CF-Connecting-IP": ip, ...(body ? { "Content-Type": "application/json" } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        }),
        target,
      );
      return { status: res.status, data: (await res.json()) as any };
    };
    const report = (over: Record<string, unknown> = {}) =>
      call("POST", "/sources", { prof: "tailoring", spell: 3914, kind: "vendor", place: "Borya", zone: "Orgrimmar", note: "", website: "", ...over });

    expect((await report()).status).toBe(201);
    expect((await report({ place: "  borya " })).status).toBe(201);
    expect((await report({ kind: "teleport" })).status).toBe(400);
    expect((await report({ place: "x" })).status).toBe(400);
    expect((await report({ spell: "abc" })).status).toBe(400);
    expect((await report({ website: "http://spam.example" })).status).toBe(200);

    // Nothing shows before approval.
    expect((await call("GET", "/sources/tailoring/3914")).data.sources).toEqual([]);

    const { results } = await env.DB.prepare("SELECT id FROM source_reports WHERE spell = 3914 ORDER BY id").all<{ id: number }>();
    expect(results).toHaveLength(2);
    const moderate = async (id: number, action: string, sig?: string) =>
      call("POST", "/moderate/sources", { id, action, sig: sig ?? (await signReport("report-secret", `${id}:${action}`)) });
    expect((await moderate(results[0].id, "approve", "0".repeat(64))).status).toBe(403);
    // A link signed for "reject" can't approve.
    expect((await moderate(results[0].id, "approve", await signReport("report-secret", `${results[0].id}:reject`))).status).toBe(403);
    expect((await moderate(results[0].id, "approve")).status).toBe(200);
    expect((await moderate(results[1].id, "approve")).status).toBe(200);

    const { sources } = (await call("GET", "/sources/tailoring/3914")).data;
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ kind: "vendor", zone: "Orgrimmar", reports: 2 });

    // Without the secret, approval is impossible.
    expect((await call("POST", "/moderate/sources", { id: results[0].id, action: "approve", sig: "x" }, env)).status).toBe(400);
  });
});
