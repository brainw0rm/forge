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

/** Minimal cookie-jar client; each gets its own IP so rate limits don't interfere. */
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

/** Latest token emailed to `to` for a link path like /verify-email or /reset-password. */
async function mailedToken(to: string, path: string): Promise<string> {
  const row = await env.DB.prepare("SELECT text FROM dev_outbox WHERE to_addr = ? ORDER BY id DESC LIMIT 1")
    .bind(to)
    .first<{ text: string }>();
  const m = new RegExp(`${path}\\?token=([^\\s]+)`).exec(row?.text ?? "");
  if (!m) throw new Error(`no ${path} mail for ${to}`);
  return decodeURIComponent(m[1]);
}

let userCounter = 0;

/** Signed-up (and by default email-verified) user. */
async function user({ verified = true } = {}) {
  const n = ++userCounter;
  const creds = { username: `user${n}`, email: `user${n}@forge.test`, password: `password-${n}-long` };
  const api = client();
  const res = await api("POST", "/auth/signup", creds);
  expect(res.status).toBe(201);
  if (verified) {
    const v = await api("POST", "/auth/verify", { token: await mailedToken(creds.email, "/verify-email") });
    expect(v.data.user.emailVerified).toBe(true);
  }
  return { api, ...creds, id: res.data.user.id as number };
}

const build = (over: Record<string, unknown> = {}) => ({
  class: "warrior",
  code: "AbCAbCAbCAbCAbC",
  split: "0/5/0",
  title: "Leveling fury",
  description: "Five points into Booming Voice.",
  isPublic: true,
  gameBuild: 70094,
  ...over,
});

describe("accounts", () => {
  it("signs up, reads the session, logs out and back in", async () => {
    const api = client();
    const signup = await api("POST", "/auth/signup", { username: "Thrall", email: "t@horde.test", password: "for-the-horde" });
    expect(signup.status).toBe(201);
    expect(signup.data.mailSent).toBe(true);
    expect(signup.setCookie).toMatch(/HttpOnly; SameSite=Lax/);
    expect((await api("GET", "/me")).data.user).toMatchObject({ username: "Thrall", emailVerified: false, role: "user" });

    await api("POST", "/auth/logout", {});
    expect((await api("GET", "/me")).data.user).toBeNull();

    expect((await api("POST", "/auth/login", { login: "thrall", password: "nope-nope" })).status).toBe(401);
    const login = await api("POST", "/auth/login", { login: "T@HORDE.test", password: "for-the-horde" });
    expect(login.status).toBe(200);
    expect(login.data.user.username).toBe("Thrall");
  });

  it("rejects duplicates and bad input", async () => {
    const api = client();
    expect((await api("POST", "/auth/signup", { username: "thrall", email: "x@y.test", password: "12345678" })).status).toBe(409);
    expect((await api("POST", "/auth/signup", { username: "a", email: "x@y.test", password: "12345678" })).status).toBe(400);
    expect((await api("POST", "/auth/signup", { username: "Jaina", email: "nope", password: "12345678" })).status).toBe(400);
    expect((await api("POST", "/auth/signup", { username: "Jaina", email: "j@a.test", password: "short" })).status).toBe(400);
  });

  it("refuses cross-origin writes", async () => {
    const res = await client()("POST", "/auth/login", { login: "x", password: "y" }, { Origin: "https://evil.test" });
    expect(res.status).toBe(403);
  });

  it("rate-limits repeated login attempts", async () => {
    const api = client();
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await api("POST", "/auth/login", { login: "x", password: "wrong-pass" })).status;
    expect(last).toBe(429);
  });

  it("verifies email with a one-time link", async () => {
    const u = await user({ verified: false });
    const token = await mailedToken(u.email, "/verify-email");
    expect((await u.api("POST", "/auth/verify", { token: "bogus" })).status).toBe(400);
    expect((await u.api("POST", "/auth/verify", { token })).data.user.emailVerified).toBe(true);
    expect((await u.api("POST", "/auth/verify", { token })).status).toBe(400); // single use
    expect((await u.api("POST", "/auth/resend-verification", {})).status).toBe(400); // already verified
  });

  it("throttles verification resends", async () => {
    const u = await user({ verified: false });
    expect((await u.api("POST", "/auth/resend-verification", {})).status).toBe(429); // signup mail was just sent
    await env.DB.prepare("UPDATE email_tokens SET created_at = created_at - 120000 WHERE user_id = ?").bind(u.id).run();
    expect((await u.api("POST", "/auth/resend-verification", {})).status).toBe(200);
  });

  it("resets a forgotten password and signs out other sessions", async () => {
    const u = await user();
    const otherDevice = client();
    await otherDevice("POST", "/auth/login", { login: u.username, password: u.password });

    const anon = client();
    // Same answer for unknown addresses, so emails can't be probed.
    expect((await anon("POST", "/auth/forgot", { email: "nobody@forge.test" })).status).toBe(200);
    expect((await anon("POST", "/auth/forgot", { email: u.email })).status).toBe(200);
    const token = await mailedToken(u.email, "/reset-password");

    expect((await anon("POST", "/auth/reset", { token, password: "short" })).status).toBe(400);
    const reset = await anon("POST", "/auth/reset", { token, password: "brand-new-password" });
    expect(reset.status).toBe(200);
    expect(reset.data.user.username).toBe(u.username);
    expect((await anon("GET", "/me")).data.user.username).toBe(u.username); // signed in by the reset
    expect((await anon("POST", "/auth/reset", { token, password: "another-password" })).status).toBe(400);

    expect((await otherDevice("GET", "/me")).data.user).toBeNull();
    expect((await client()("POST", "/auth/login", { login: u.username, password: u.password })).status).toBe(401);
    expect((await client()("POST", "/auth/login", { login: u.username, password: "brand-new-password" })).status).toBe(200);
  });

  it("changes the password, keeping only the current session", async () => {
    const u = await user();
    const otherDevice = client();
    await otherDevice("POST", "/auth/login", { login: u.username, password: u.password });
    expect((await u.api("PUT", "/me/password", { current: "wrong-one", password: "next-password-1" })).status).toBe(401);
    expect((await u.api("PUT", "/me/password", { current: u.password, password: "next-password-1" })).status).toBe(200);
    expect((await u.api("GET", "/me")).data.user.username).toBe(u.username);
    expect((await otherDevice("GET", "/me")).data.user).toBeNull();
  });

  it("deletes an account and everything it owns", async () => {
    const u = await user();
    const { data } = await u.api("POST", "/builds", build({ title: "Unholy aura" }));
    expect((await u.api("DELETE", "/me", { password: "wrong-password" })).status).toBe(401);
    expect((await u.api("DELETE", "/me", { password: u.password })).status).toBe(200);
    expect((await client()("GET", `/builds/${data.build.id}`)).status).toBe(404);
  });
});

describe("builds and ratings", () => {
  it("saves, lists, rates and protects builds", async () => {
    const author = await user();
    const saved = await author.api("POST", "/builds", build({ class: "druid", title: "Feral leveling" }));
    expect(saved.status).toBe(201);
    const id = saved.data.build.id;
    const hidden = await author.api("POST", "/builds", build({ class: "druid", title: "Secret tank", isPublic: false }));

    const rater = await user();
    expect((await rater.api("GET", `/builds/${hidden.data.build.id}`)).status).toBe(404);
    expect((await rater.api("GET", "/builds?class=druid")).data.builds.map((b: any) => b.id)).toEqual([id]);

    expect((await rater.api("PUT", `/builds/${id}`, build({ class: "druid", title: "Mine now" }))).status).toBe(403);
    expect((await rater.api("DELETE", `/builds/${id}`)).status).toBe(403);

    expect((await author.api("PUT", `/builds/${id}/rating`, { stars: 5 })).status).toBe(403);
    expect((await rater.api("PUT", `/builds/${id}/rating`, { stars: 6 })).status).toBe(400);
    await rater.api("PUT", `/builds/${id}/rating`, { stars: 2 });
    const rated = await rater.api("PUT", `/builds/${id}/rating`, { stars: 4 });
    expect(rated.data.build.rating).toEqual({ avg: 4, count: 1 });
    expect(rated.data.build.myRating).toBe(4);

    const edited = await author.api("PUT", `/builds/${id}`, build({ class: "druid", title: "Feral leveling v2" }));
    expect(edited.data.build.title).toBe("Feral leveling v2");
    expect((await author.api("GET", "/me/builds")).data.builds).toHaveLength(2);

    const anon = client();
    expect((await anon("GET", `/builds/${id}`)).data.build.rating.count).toBe(1);
    expect((await anon("PUT", `/builds/${id}/rating`, { stars: 1 })).status).toBe(401);
  });

  it("requires a confirmed email to publish or rate, but not to save privately", async () => {
    const u = await user({ verified: false });
    expect((await u.api("POST", "/builds", build())).status).toBe(403);
    expect((await u.api("POST", "/builds", build({ isPublic: false }))).status).toBe(201);
    const other = await user();
    const { data } = await other.api("POST", "/builds", build({ title: "Rate me" }));
    expect((await u.api("PUT", `/builds/${data.build.id}/rating`, { stars: 5 })).status).toBe(403);
  });

  it("validates build input", async () => {
    const { api } = await user();
    expect((await api("POST", "/builds", build({ class: "deathknight" }))).status).toBe(400);
    expect((await api("POST", "/builds", build({ code: "abcd" }))).status).toBe(400);
    expect((await api("POST", "/builds", build({ title: "x" }))).status).toBe(400);
    expect((await api("POST", "/builds", build({ split: "40/40/0" }))).status).toBe(400);
  });
});

describe("reports and moderation", () => {
  it("hides a build after three reports and lets an admin review it", async () => {
    const author = await user();
    const { data } = await author.api("POST", "/builds", build({ class: "shaman", title: "Buy gold at example.test" }));
    const id = data.build.id;

    const reporters = [await user(), await user(), await user()];
    expect((await author.api("POST", `/builds/${id}/report`, { reason: "spam" })).status).toBe(400); // own build
    expect((await reporters[0].api("POST", `/builds/${id}/report`, { reason: "nonsense" })).status).toBe(400);
    expect((await reporters[0].api("POST", `/builds/${id}/report`, { reason: "spam", details: "Gold seller" })).status).toBe(201);
    expect((await reporters[0].api("POST", `/builds/${id}/report`, { reason: "spam" })).status).toBe(409); // once per user
    expect((await reporters[0].api("GET", `/builds/${id}`)).data.build.reported).toBe(true);
    await reporters[1].api("POST", `/builds/${id}/report`, { reason: "spam" });
    expect((await client()("GET", "/builds?class=shaman")).data.builds).toHaveLength(1);
    await reporters[2].api("POST", `/builds/${id}/report`, { reason: "offensive" });

    // Hidden from everyone but the owner (and admins).
    expect((await client()("GET", "/builds?class=shaman")).data.builds).toHaveLength(0);
    expect((await client()("GET", `/builds/${id}`)).status).toBe(404);
    expect((await author.api("GET", `/builds/${id}`)).data.build.hidden).toBe(true);

    const mod = await user();
    expect((await mod.api("GET", "/admin/reports")).status).toBe(403);
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(mod.id).run();
    const queue = (await mod.api("GET", "/admin/reports")).data.queue;
    const entry = queue.find((q: any) => q.build.id === id);
    expect(entry.reports).toHaveLength(3);
    expect(entry.reports[0]).toMatchObject({ reason: "spam", details: "Gold seller", reporter: reporters[0].username });

    // Dismissing restores the build and clears the queue entry.
    expect((await mod.api("POST", `/admin/builds/${id}/moderate`, { action: "dismiss" })).status).toBe(200);
    expect((await client()("GET", `/builds/${id}`)).status).toBe(200);
    expect((await mod.api("GET", "/admin/reports")).data.queue.some((q: any) => q.build.id === id)).toBe(false);

    // Deleting removes it for good.
    expect((await mod.api("POST", `/admin/builds/${id}/moderate`, { action: "delete" })).status).toBe(200);
    expect((await author.api("GET", `/builds/${id}`)).status).toBe(404);
  });
});

describe("talent popularity", () => {
  it("counts picks per talent overall and by level, public builds only", async () => {
    const { encode } = await import("../shared/code");
    const u = await user();
    // 12 points: talent 100 x5, 101 x5, 102 x2 -> reaches level 20 (11 points) but not 30.
    const long = encode([100, 100, 100, 100, 100, 101, 101, 101, 101, 101, 102, 102]);
    const short = encode([100, 103]);
    await u.api("POST", "/builds", build({ class: "hunter", code: long, split: "12/0/0" }));
    await u.api("POST", "/builds", build({ class: "hunter", code: short, split: "2/0/0" }));
    await u.api("POST", "/builds", build({ class: "hunter", code: encode([104]), split: "1/0/0", isPublic: false }));
    const { data } = await client()("GET", "/stats/talents?class=hunter");
    expect(data.builds).toBe(2);
    expect(data.picks).toEqual({ 100: 2, 101: 1, 102: 1, 103: 1 });
    const at20 = data.brackets.find((b: any) => b.level === 20);
    expect(at20.builds).toBe(1);
    expect(at20.picks).toEqual({ 100: 1, 101: 1, 102: 1 });
    expect(data.brackets.find((b: any) => b.level === 30).builds).toBe(0);
    expect((await client()("GET", "/stats/talents?class=nope")).status).toBe(400);
  });
});

describe("change alerts", () => {
  it("emails a digest to watchers when a new beta build changes watched talents", async () => {
    const { encode } = await import("../shared/code");
    // Fake static assets: the notify job reads meta.json and changelog.json from the site.
    let meta = { build: "1.60.1.100" };
    let changelog: unknown[] = [];
    const alerting: Env = {
      ...env,
      NOTIFY_SECRET: "test-secret",
      ASSETS: {
        fetch: async (url: string) =>
          new Response(JSON.stringify(String(url).endsWith("meta.json") ? meta : changelog)),
      } as unknown as Fetcher,
    };
    const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
      handle(
        new Request(`${ORIGIN}/api${path}`, {
          method,
          headers: { Origin: ORIGIN, ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
          body: body ? JSON.stringify(body) : undefined,
        }),
        alerting,
      ).then(async (r) => ({ status: r.status, data: (await r.json()) as any }));

    const unverified = await user({ verified: false });
    expect((await unverified.api("PUT", "/watches", { kind: "class", target: "druid" })).status).toBe(403);

    const watcher = await user();
    const { data } = await watcher.api("POST", "/builds", build({ class: "druid", code: encode([500, 501]), split: "2/0/0" }));
    expect((await watcher.api("PUT", "/watches", { kind: "build", target: data.build.id })).status).toBe(200);
    expect((await watcher.api("PUT", "/watches", { kind: "class", target: "nope" })).status).toBe(400);
    expect((await watcher.api("GET", "/me/watches")).data.watches).toHaveLength(1);

    expect((await call("POST", "/internal/notify", {})).status).toBe(401);
    const auth = { Authorization: "Bearer test-secret" };
    // First run only records the current build.
    expect((await call("POST", "/internal/notify", {}, auth)).data).toMatchObject({ initialized: true, sent: 0 });

    meta = { build: "1.60.1.101" };
    changelog = [
      { build: "1.60.1.101", changes: [
        { type: "changed", kinds: ["text"], talent: 501, class: "druid", name: "Feral Instinct" },
        { type: "changed", kinds: ["text"], talent: 999, class: "druid", name: "Not in the build" },
      ] },
    ];
    const run = await call("POST", "/internal/notify", {}, auth);
    expect(run.data).toMatchObject({ build: 101, sent: 1 });
    const mail = await env.DB.prepare("SELECT subject, text FROM dev_outbox WHERE to_addr = ? ORDER BY id DESC LIMIT 1")
      .bind(watcher.email)
      .first<{ subject: string; text: string }>();
    expect(mail!.subject).toMatch(/1 talent change/);
    expect(mail!.text).toContain("Feral Instinct");
    expect(mail!.text).not.toContain("Not in the build");
    // Nothing new: no second email.
    expect((await call("POST", "/internal/notify", {}, auth)).data.sent).toBe(0);

    // One-click unsubscribe from the email link.
    const [, u, t] = /unsubscribe\?u=(\d+)&t=(\S+)/.exec(mail!.text)!;
    expect((await call("POST", "/unsubscribe", { u: Number(u), t: "forged" })).status).toBe(400);
    expect((await call("POST", "/unsubscribe", { u: Number(u), t })).status).toBe(200);
    expect((await watcher.api("GET", "/me/watches")).data.watches).toHaveLength(0);
  });
});

describe("dev outbox", () => {
  it("is only reachable when enabled", async () => {
    expect((await client()("GET", "/dev/outbox")).status).toBe(200);
    const off = { ...env, DEV_MAIL_OUTBOX: undefined };
    const res = await handle(new Request(`${ORIGIN}/api/dev/outbox`), off);
    expect(res.status).toBe(404);
  });
});

describe("news", () => {
  it("stores headlines from the fetch job, lists them and lets admins hide them", async () => {
    const withSecret: Env = { ...env, NOTIFY_SECRET: "news-secret" };
    const ingest = (items: unknown[], secret = "news-secret") =>
      handle(
        new Request(`${ORIGIN}/api/internal/news`, {
          method: "POST",
          headers: { Origin: ORIGIN, "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
          body: JSON.stringify({ items }),
        }),
        withSecret,
      ).then(async (r) => ({ status: r.status, data: (await r.json()) as any }));
    const now = Date.now();
    const good = [
      { source: "wowhead", title: "New Dungeon in WoW: Forever", url: "https://www.wowhead.com/news=1/new-dungeon?utm_source=rss", published: now - 3_600_000 },
      { source: "buffed", title: "WoW Forever: Neuer Dungeon", url: "https://www.buffed.de/wow/news/1", published: now - 7_200_000 },
    ];
    const bad = [
      { source: "wowhead", title: "Link to another host", url: "https://evil.example/news=2", published: now },
      { source: "nobody", title: "Unknown source", url: "https://www.wowhead.com/news=3", published: now },
      { source: "wowhead", title: "", url: "https://www.wowhead.com/news=4", published: now },
      { source: "wowhead", title: "x".repeat(500), url: "https://www.wowhead.com/news=5", published: now },
    ];

    expect((await ingest(good, "wrong")).status).toBe(401);
    const first = await ingest([...good, ...bad]);
    expect(first.data).toMatchObject({ received: 6, accepted: 2, added: 2 });
    expect((await ingest(good)).data.added).toBe(0); // idempotent

    const reader = client();
    const all = (await reader("GET", "/news")).data;
    expect(all.items.map((i: any) => i.title)).toEqual(["New Dungeon in WoW: Forever", "WoW Forever: Neuer Dungeon"]);
    expect(all.items[0].url).toBe("https://www.wowhead.com/news=1/new-dungeon"); // tracking params dropped
    expect(all.items[0]).not.toHaveProperty("description");
    expect((await reader("GET", "/news?lang=de")).data.items).toHaveLength(1);
    expect((await reader("GET", "/news?source=wowhead")).data.items).toHaveLength(1);
    expect((await reader("GET", `/news?before=${now - 3_600_000}`)).data.items).toHaveLength(1);

    const mod = await user();
    const url = all.items[0].url;
    expect((await mod.api("POST", "/admin/news/hide", { url })).status).toBe(403);
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(mod.id).run();
    expect((await mod.api("POST", "/admin/news/hide", { url })).status).toBe(200);
    await ingest(good); // the next fetch must not bring it back
    expect((await reader("GET", "/news")).data.items.map((i: any) => i.url)).not.toContain(url);
    expect((await mod.api("GET", "/admin/news")).data.items.find((i: any) => i.url === url).hidden).toBe(true);
    expect((await mod.api("POST", "/admin/news/unhide", { url })).status).toBe(200);
    expect((await reader("GET", "/news")).data.items.map((i: any) => i.url)).toContain(url);
  });
});

describe("deleting builds", () => {
  it("removes everyone's change alerts for the build and shows report counts only to moderators", async () => {
    const owner = await user();
    const fan = await user();
    const { data } = await owner.api("POST", "/builds", build({ class: "mage" }));
    const id = data.build.id;
    expect((await fan.api("PUT", "/watches", { kind: "build", target: id })).status).toBe(200);
    expect((await fan.api("GET", "/me/watches")).data.watches.map((w: any) => w.target)).toContain(id);

    expect((await fan.api("POST", `/builds/${id}/report`, { reason: "spam", details: "" })).status).toBe(201);
    expect((await owner.api("GET", `/builds/${id}`)).data.build).not.toHaveProperty("openReports");
    const mod = await user();
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(mod.id).run();
    expect((await mod.api("GET", `/builds/${id}`)).data.build.openReports).toBe(1);

    expect((await owner.api("DELETE", `/builds/${id}`)).status).toBe(200);
    expect((await fan.api("GET", "/me/watches")).data.watches.map((w: any) => w.target)).not.toContain(id);
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM watches WHERE target = ?").bind(id).first<{ n: number }>();
    expect(left?.n).toBe(0);
  });
});

describe("saved build validation", () => {
  it("checks talents against the class data and derives the point split itself", async () => {
    // Serve the real generated class data, like the ASSETS binding does in production.
    const withAssets: Env = {
      ...env,
      ASSETS: {
        fetch: async (url: string) => {
          const path = new URL(url).pathname;
          try {
            return new Response(readFileSync(new URL(`../public${path}`, import.meta.url)));
          } catch {
            return new Response("not found", { status: 404 });
          }
        },
      } as unknown as Fetcher,
    };
    const u = await user();
    const save = (over: Record<string, unknown>) => u.api("POST", "/builds", build(over), {}, withAssets);
    const mage = JSON.parse(readFileSync(new URL("../public/data/classes/mage.json", import.meta.url), "utf8"));
    const { encode } = await import("../shared/code");
    const first = mage.trees[2].talents.find((t: any) => t.tier === 0);

    const honest = await save({ class: "mage", code: encode([first.id, first.id]), split: "51/0/0" });
    expect(honest.status).toBe(201);
    expect(honest.data.build).toMatchObject({ split: "0/0/2", points: 2 });

    const wrongClass = await save({ class: "warrior", code: encode([first.id]), split: "0/0/1" });
    expect(wrongClass.status).toBe(400);
    const tooMany = await save({ class: "mage", code: encode(new Array(first.ranks.length + 1).fill(first.id)), split: "0/0/9" });
    expect(tooMany.status).toBe(400);
  });
});

describe("bug reports", () => {
  it("accepts reports from anyone, ignores bots and lets moderators resolve them", async () => {
    const visitor = client();
    const report = (over: Record<string, unknown> = {}) =>
      visitor("POST", "/feedback", {
        kind: "bug",
        message: "The talent tooltip covers the whole screen on my phone.",
        email: "",
        page: "/talents/mage",
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

    const mod = await user();
    expect((await mod.api("GET", "/admin/feedback")).status).toBe(403);
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(mod.id).run();
    const { reports } = (await mod.api("GET", "/admin/feedback")).data;
    const mine = reports.filter((r: any) => r.page === "/talents/mage");
    expect(mine).toHaveLength(1);
    expect(mine[0].context).toEqual({ browser: "TestBrowser/1.0", screen: "375×812", build: "1.60.1.70094" });
    expect(reports.some((r: any) => r.message.includes("cheap gold"))).toBe(false);
    expect((await mod.api("POST", `/admin/feedback/${mine[0].id}/resolve`, {})).status).toBe(200);
    expect((await mod.api("GET", "/admin/feedback")).data.reports.some((r: any) => r.id === mine[0].id)).toBe(false);
  });
});
