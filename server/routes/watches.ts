// Change alerts: watch a class or a saved build; an internal job emails a digest when a
// new game build changes talents you're watching.

import { decode } from "../../shared/code";
import { isClassSlug } from "../../shared/validate";
import { appUrl, body, fail, json, str, type Env, type Route } from "../http";
import { alertMail, sendMail, type AlertSection } from "../mail";
import { requireUser, requireVerified } from "./account";
import { findBuild } from "./builds";

const MAX_WATCHES = 50;
const enc = new TextEncoder();

interface ChangelogEntry {
  build: string;
  changes: { type: string; kinds?: string[]; talent: number; class: string; name: string }[];
}

const buildNo = (b: string) => Number(b.split(".").pop());

/** HMAC token for one-click unsubscribe links (no sign-in needed). */
export async function unsubscribeToken(secret: string, userId: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`unsubscribe:${userId}`)));
  let s = "";
  for (const b of sig) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function readWatch(input: { kind?: unknown; target?: unknown }) {
  const kind = str(input.kind);
  const target = str(input.target);
  if (kind === "class") {
    if (!isClassSlug(target)) fail(400, "Unknown class.");
  } else if (kind === "build") {
    if (!/^[A-Za-z0-9]{6,16}$/.test(target)) fail(400, "Unknown build.");
  } else fail(400, "Watch a class or a build.");
  return { kind, target };
}

async function assets<T>(env: Env, req: Request, path: string): Promise<T> {
  if (!env.ASSETS) fail(500, "ASSETS binding missing.");
  const res = await env.ASSETS!.fetch(new URL(path, req.url).toString());
  if (!res.ok) fail(500, `Couldn't load ${path}.`);
  return (await res.json()) as T;
}

export const watchRoutes: Route[] = [
  [
    "GET",
    /^\/me\/watches$/,
    async (req, env) => {
      const user = await requireUser(env, req);
      const { results } = await env.DB.prepare(
        `SELECT w.kind, w.target, w.created_at, b.title, b.class FROM watches w
         LEFT JOIN builds b ON w.kind = 'build' AND b.id = w.target
         WHERE w.user_id = ? AND (w.kind <> 'build' OR b.id IS NOT NULL) ORDER BY w.created_at DESC`,
      )
        .bind(user.id)
        .all<{ kind: string; target: string; created_at: number; title: string | null; class: string | null }>();
      return json({
        watches: results.map((r) => ({ kind: r.kind, target: r.target, createdAt: r.created_at, title: r.title, class: r.class })),
      });
    },
  ],
  [
    "PUT",
    /^\/watches$/,
    async (req, env) => {
      const user = await requireVerified(env, req, "get change alerts by email");
      const { kind, target } = readWatch(await body(req));
      if (kind === "build") await findBuild(env, target, user); // must exist and be visible to you
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM watches WHERE user_id = ?").bind(user.id).first<{ n: number }>();
      if ((count?.n ?? 0) >= MAX_WATCHES) fail(400, `You can watch up to ${MAX_WATCHES} classes and builds.`);
      await env.DB.prepare("INSERT INTO watches (user_id, kind, target, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING")
        .bind(user.id, kind, target, Date.now())
        .run();
      return json({ ok: true });
    },
  ],
  [
    "DELETE",
    /^\/watches$/,
    async (req, env) => {
      const user = await requireUser(env, req);
      const { kind, target } = readWatch(await body(req));
      await env.DB.prepare("DELETE FROM watches WHERE user_id = ? AND kind = ? AND target = ?").bind(user.id, kind, target).run();
      return json({ ok: true });
    },
  ],
  [
    "POST",
    /^\/unsubscribe$/,
    async (req, env) => {
      const input = await body<{ u?: unknown; t?: unknown }>(req);
      const userId = Number(input.u);
      if (!env.NOTIFY_SECRET || !Number.isInteger(userId) || str(input.t) !== (await unsubscribeToken(env.NOTIFY_SECRET, userId)))
        fail(400, "This unsubscribe link is invalid.");
      await env.DB.prepare("DELETE FROM watches WHERE user_id = ?").bind(userId).run();
      return json({ ok: true });
    },
  ],
  [
    "POST",
    /^\/internal\/notify$/,
    async (req, env) => {
      // Called by the data-refresh job after a new game build is deployed.
      const auth = req.headers.get("Authorization") ?? "";
      if (!env.NOTIFY_SECRET || auth !== `Bearer ${env.NOTIFY_SECRET}`) fail(401, "Not allowed.");
      const [meta, log] = await Promise.all([
        assets<{ build: string }>(env, req, "/data/meta.json"),
        assets<ChangelogEntry[]>(env, req, "/data/changelog.json"),
      ]);
      const latest = buildNo(meta.build);
      const state = await env.DB.prepare("SELECT value FROM job_state WHERE key = 'alerts_build'").first<{ value: string }>();
      const saveState = env.DB.prepare(
        "INSERT INTO job_state (key, value) VALUES ('alerts_build', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      ).bind(String(latest));
      if (!state) {
        // First run: start from the current build instead of mailing the whole history.
        await saveState.run();
        return json({ initialized: true, build: latest, sent: 0 });
      }
      const since = Number(state.value);
      const changes = log.filter((e) => buildNo(e.build) > since).flatMap((e) => e.changes.map((c) => ({ ...c, build: e.build })));
      if (!changes.length) {
        await saveState.run();
        return json({ build: latest, sent: 0 });
      }

      const { results: watches } = await env.DB.prepare(
        `SELECT w.user_id, w.kind, w.target, u.email, u.username, b.class AS b_class, b.code AS b_code, b.title AS b_title
         FROM watches w JOIN users u ON u.id = w.user_id
         LEFT JOIN builds b ON w.kind = 'build' AND b.id = w.target
         WHERE u.email_verified_at IS NOT NULL`,
      ).all<{ user_id: number; kind: string; target: string; email: string; username: string; b_class: string | null; b_code: string | null; b_title: string | null }>();

      const site = appUrl(env, req);
      const perUser = new Map<number, { email: string; username: string; sections: AlertSection[] }>();
      for (const w of watches) {
        let hits = changes;
        let section: Omit<AlertSection, "changes">;
        if (w.kind === "class") {
          hits = changes.filter((c) => c.class === w.target);
          section = { title: `${w.target[0].toUpperCase()}${w.target.slice(1)} talents`, url: `${site}/talents/${w.target}?lens=changes` };
        } else {
          if (!w.b_code || !w.b_class) continue; // build was deleted
          const talents = new Set(decode(w.b_code));
          hits = changes.filter((c) => c.class === w.b_class && talents.has(c.talent));
          section = { title: `Your watched build “${w.b_title}”`, url: `${site}/builds/${w.target}` };
        }
        if (!hits.length) continue;
        const entry = perUser.get(w.user_id) ?? { email: w.email, username: w.username, sections: [] };
        entry.sections.push({ ...section, changes: hits.map((c) => ({ name: c.name, what: describe(c) })) });
        perUser.set(w.user_id, entry);
      }

      let sent = 0;
      for (const [userId, u] of perUser) {
        const unsubscribe = `${site}/unsubscribe?u=${userId}&t=${await unsubscribeToken(env.NOTIFY_SECRET!, userId)}`;
        try {
          await sendMail(env, alertMail(u.email, u.username, meta.build, u.sections, `${site}/changes`, unsubscribe));
          sent++;
        } catch (err) {
          console.error("alert mail failed", userId, err);
        }
      }
      await saveState.run();
      return json({ build: latest, since, changes: changes.length, sent });
    },
  ],
];

function describe(c: { type: string; kinds?: string[] }) {
  if (c.type === "added") return "added";
  if (c.type === "removed") return "removed";
  const words: Record<string, string> = { text: "tooltip changed", ranks: "rank count changed", moved: "moved", renamed: "renamed", prereq: "requirement changed", req: "point requirement changed" };
  return (c.kinds ?? []).map((k) => words[k] ?? k).join(", ");
}
