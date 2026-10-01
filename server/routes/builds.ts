// Saved builds, ratings and reports.

import {
  checkCode,
  checkDescription,
  checkSplit,
  checkTitle,
  CODE_CHARS,
  isClassSlug,
  LIMITS,
  REPORT_REASONS,
} from "../../shared/validate";
import { Build, indexClass, split as splitOf } from "../../src/build";
import type { ClassData } from "../../src/data";
import { decode } from "../../shared/code";
import { shortId, userFromRequest, type SessionUser } from "../auth";
import { body, check, fail, json, str, type Env, type Route } from "../http";
import { requireUser, requireVerified } from "./account";

const PAGE_SIZE = 18;
const MAX_BUILDS_PER_USER = 200;
/** Open reports from this many different users hide a build until a moderator reviews it. */
export const AUTO_HIDE_REPORTS = 3;
// Bayesian prior for "top" sorting: a build needs a few ratings before it can outrank
// well-established ones (as if every build started with PRIOR_COUNT ratings of PRIOR_MEAN).
const PRIOR_COUNT = 3;
const PRIOR_MEAN = 3;

const ID = "([A-Za-z0-9]{6,16})";

export interface BuildRow {
  id: string;
  user_id: number;
  username: string;
  class: string;
  code: string;
  split: string;
  points: number;
  title: string;
  description: string;
  is_public: number;
  hidden: number;
  game_build: number;
  created_at: number;
  updated_at: number;
  rating_avg: number | null;
  rating_count: number;
  my_rating: number | null;
  my_report: number;
  open_reports: number;
}

export const BUILD_SELECT = `
  SELECT b.*, u.username,
    (SELECT AVG(stars) FROM ratings r WHERE r.build_id = b.id) AS rating_avg,
    (SELECT COUNT(*) FROM ratings r WHERE r.build_id = b.id) AS rating_count,
    (SELECT stars FROM ratings r WHERE r.build_id = b.id AND r.user_id = ?1) AS my_rating,
    EXISTS (SELECT 1 FROM reports p WHERE p.build_id = b.id AND p.reporter_id = ?1 AND p.resolved_at IS NULL) AS my_report,
    (SELECT COUNT(*) FROM reports p WHERE p.build_id = b.id AND p.resolved_at IS NULL) AS open_reports
  FROM builds b JOIN users u ON u.id = b.user_id`;

export function toBuild(row: BuildRow, viewer: SessionUser | null) {
  return {
    id: row.id,
    class: row.class,
    code: row.code,
    split: row.split,
    points: row.points,
    title: row.title,
    description: row.description,
    isPublic: row.is_public === 1,
    hidden: row.hidden === 1,
    gameBuild: row.game_build,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: row.username,
    rating: { avg: row.rating_avg ?? 0, count: row.rating_count },
    myRating: row.my_rating,
    reported: row.my_report === 1,
    mine: viewer?.id === row.user_id,
    // Moderators only: how many unresolved reports the build has.
    ...(viewer?.role === "admin" ? { openReports: row.open_reports } : {}),
  };
}

/** Deletes a build and everyone's change alerts for it (watches reference builds by id only). */
export async function deleteBuild(env: Env, id: string) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM watches WHERE kind = 'build' AND target = ?").bind(id),
    env.DB.prepare("DELETE FROM builds WHERE id = ?").bind(id),
  ]);
}

export async function findBuild(env: Env, id: string, viewer: SessionUser | null): Promise<BuildRow> {
  const row = await env.DB.prepare(`${BUILD_SELECT} WHERE b.id = ?2`)
    .bind(viewer?.id ?? 0, id)
    .first<BuildRow>();
  // Private and moderator-hidden builds are only visible to their owner and to admins.
  const privileged = !!viewer && (row?.user_id === viewer.id || viewer.role === "admin");
  if (!row || ((row.is_public !== 1 || row.hidden === 1) && !privileged)) return fail(404, "Build not found.");
  return row;
}

interface BuildInput {
  class?: unknown;
  code?: unknown;
  split?: unknown;
  title?: unknown;
  description?: unknown;
  isPublic?: unknown;
  gameBuild?: unknown;
}

function readBuildInput(input: BuildInput, user: SessionUser) {
  const cls = str(input.class);
  if (!isClassSlug(cls)) fail(400, "Unknown class.");
  const code = str(input.code);
  const split = str(input.split);
  const title = str(input.title).trim();
  const description = str(input.description).trim();
  check(checkCode(code));
  check(checkSplit(split));
  check(checkTitle(title));
  check(checkDescription(description));
  const gameBuild = Number(input.gameBuild);
  if (!Number.isInteger(gameBuild) || gameBuild < 0) fail(400, "Invalid game build.");
  const isPublic = input.isPublic === false ? 0 : 1;
  if (isPublic && user.email_verified_at === null)
    fail(403, "Confirm your email address to publish builds. You can still save them as private.");
  return { cls, code, split, points: code.length / CODE_CHARS, title, description, isPublic, gameBuild };
}

const classCache = new Map<string, Promise<ClassData>>();

/** Replays the build with the calculator's rules against the class data: talents that don't exist
 * for the class (or break tier/prerequisite rules) are rejected, and split and point count come
 * from the talents themselves instead of what the client claims. */
async function verifyTalents(env: Env, req: Request, b: ReturnType<typeof readBuildInput>) {
  if (!env.ASSETS) return b; // API tests without static assets
  let data = classCache.get(b.cls);
  if (!data) {
    data = env.ASSETS.fetch(new URL(`/data/classes/${b.cls}.json`, req.url).toString()).then((r) => {
      if (!r.ok) throw new Error(`class data ${r.status}`);
      return r.json() as Promise<ClassData>;
    });
    classCache.set(b.cls, data);
    data.catch(() => classCache.delete(b.cls));
  }
  const cls = await data;
  const order = decode(b.code);
  const build = new Build(indexClass(cls), cls.trees.length, order);
  if (build.spent !== order.length)
    fail(400, "This build has talents that aren't valid for this class, or that no longer exist in the current game build.");
  return { ...b, split: splitOf(build), points: build.spent };
}

export const buildRoutes: Route[] = [
  [
    "GET",
    /^\/me\/builds$/,
    async (req, env) => {
      const user = await requireUser(env, req);
      const { results } = await env.DB.prepare(`${BUILD_SELECT} WHERE b.user_id = ?1 ORDER BY b.updated_at DESC`)
        .bind(user.id)
        .all<BuildRow>();
      return json({ builds: results.map((r) => toBuild(r, user)) });
    },
  ],
  [
    "GET",
    /^\/builds$/,
    async (req, env) => {
      const viewer = await userFromRequest(env.DB, req);
      const url = new URL(req.url);
      const cls = url.searchParams.get("class") ?? "";
      const sort = url.searchParams.get("sort") === "new" ? "new" : "top";
      const author = url.searchParams.get("author") ?? "";
      const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
      const page = Math.max(1, Math.min(500, Number(url.searchParams.get("page")) || 1));
      const where = ["b.is_public = 1", "b.hidden = 0"];
      const args: unknown[] = [viewer?.id ?? 0];
      if (cls) {
        if (!isClassSlug(cls)) fail(400, "Unknown class.");
        args.push(cls);
        where.push(`b.class = ?${args.length}`);
      }
      if (author) {
        args.push(author);
        where.push(`u.username = ?${args.length}`);
      }
      if (q) {
        args.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
        where.push(`(b.title LIKE ?${args.length} ESCAPE '\\' OR b.description LIKE ?${args.length} ESCAPE '\\')`);
      }
      const order =
        sort === "new"
          ? "b.created_at DESC"
          : `(COALESCE(rating_avg, 0) * rating_count + ${PRIOR_MEAN * PRIOR_COUNT}) / (rating_count + ${PRIOR_COUNT}) DESC, b.created_at DESC`;
      args.push(PAGE_SIZE + 1, (page - 1) * PAGE_SIZE);
      const sql = `${BUILD_SELECT} WHERE ${where.join(" AND ")} ORDER BY ${order}
        LIMIT ?${args.length - 1} OFFSET ?${args.length}`;
      const { results } = await env.DB.prepare(sql)
        .bind(...args)
        .all<BuildRow>();
      return json({
        builds: results.slice(0, PAGE_SIZE).map((r) => toBuild(r, viewer)),
        page,
        hasMore: results.length > PAGE_SIZE,
      });
    },
  ],
  [
    "POST",
    /^\/builds$/,
    async (req, env) => {
      const user = await requireUser(env, req);
      const b = await verifyTalents(env, req, readBuildInput(await body<BuildInput>(req), user));
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM builds WHERE user_id = ?")
        .bind(user.id)
        .first<{ n: number }>();
      if ((count?.n ?? 0) >= MAX_BUILDS_PER_USER) fail(400, `You can save up to ${MAX_BUILDS_PER_USER} builds.`);
      const id = shortId();
      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO builds (id, user_id, class, code, split, points, title, description, is_public, game_build, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(id, user.id, b.cls, b.code, b.split, b.points, b.title, b.description, b.isPublic, b.gameBuild, now, now)
        .run();
      return json({ build: toBuild(await findBuild(env, id, user), user) }, 201);
    },
  ],
  [
    "GET",
    new RegExp(`^/builds/${ID}$`),
    async (req, env, [id]) => {
      const viewer = await userFromRequest(env.DB, req);
      return json({ build: toBuild(await findBuild(env, id, viewer), viewer) });
    },
  ],
  [
    "PUT",
    new RegExp(`^/builds/${ID}$`),
    async (req, env, [id]) => {
      const user = await requireUser(env, req);
      const existing = await findBuild(env, id, user);
      if (existing.user_id !== user.id) fail(403, "You can only edit your own builds.");
      const b = await verifyTalents(env, req, readBuildInput(await body<BuildInput>(req), user));
      if (b.cls !== existing.class) fail(400, "A build's class can't change.");
      await env.DB.prepare(
        `UPDATE builds SET code = ?, split = ?, points = ?, title = ?, description = ?, is_public = ?,
           game_build = ?, updated_at = ? WHERE id = ?`,
      )
        .bind(b.code, b.split, b.points, b.title, b.description, b.isPublic, b.gameBuild, Date.now(), id)
        .run();
      return json({ build: toBuild(await findBuild(env, id, user), user) });
    },
  ],
  [
    "DELETE",
    new RegExp(`^/builds/${ID}$`),
    async (req, env, [id]) => {
      const user = await requireUser(env, req);
      const existing = await findBuild(env, id, user);
      if (existing.user_id !== user.id) fail(403, "You can only delete your own builds.");
      await deleteBuild(env, id);
      return json({ ok: true });
    },
  ],
  [
    "PUT",
    new RegExp(`^/builds/${ID}/rating$`),
    async (req, env, [id]) => {
      const user = await requireVerified(env, req, "rate builds");
      const build = await findBuild(env, id, user);
      if (build.user_id === user.id) fail(403, "You can't rate your own build.");
      if (build.is_public !== 1 || build.hidden === 1) fail(403, "This build can't be rated right now.");
      const stars = Number((await body<{ stars?: unknown }>(req)).stars);
      if (!Number.isInteger(stars) || stars < 1 || stars > 5) fail(400, "Rating must be 1–5 stars.");
      await env.DB.prepare(
        `INSERT INTO ratings (build_id, user_id, stars, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (build_id, user_id) DO UPDATE SET stars = excluded.stars`,
      )
        .bind(id, user.id, stars, Date.now())
        .run();
      return json({ build: toBuild(await findBuild(env, id, user), user) });
    },
  ],
  [
    "DELETE",
    new RegExp(`^/builds/${ID}/rating$`),
    async (req, env, [id]) => {
      const user = await requireUser(env, req);
      await findBuild(env, id, user);
      await env.DB.prepare("DELETE FROM ratings WHERE build_id = ? AND user_id = ?").bind(id, user.id).run();
      return json({ build: toBuild(await findBuild(env, id, user), user) });
    },
  ],
  [
    "POST",
    new RegExp(`^/builds/${ID}/report$`),
    async (req, env, [id]) => {
      const user = await requireVerified(env, req, "report builds");
      const build = await findBuild(env, id, user);
      if (build.user_id === user.id) fail(400, "You can't report your own build.");
      const input = await body<{ reason?: unknown; details?: unknown }>(req);
      const reason = str(input.reason);
      const details = str(input.details).trim();
      if (!(REPORT_REASONS as readonly string[]).includes(reason)) fail(400, "Choose a reason.");
      if (details.length > LIMITS.reportDetails) fail(400, `Details must be at most ${LIMITS.reportDetails} characters.`);
      const inserted = await env.DB.prepare(
        `INSERT INTO reports (build_id, reporter_id, reason, details, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING`,
      )
        .bind(id, user.id, reason, details, Date.now())
        .run();
      if (inserted.meta.changes === 0) fail(409, "You've already reported this build. A moderator will look at it.");
      const open = await env.DB.prepare(
        "SELECT COUNT(DISTINCT reporter_id) AS n FROM reports WHERE build_id = ? AND resolved_at IS NULL",
      )
        .bind(id)
        .first<{ n: number }>();
      if ((open?.n ?? 0) >= AUTO_HIDE_REPORTS) {
        await env.DB.prepare("UPDATE builds SET hidden = 1 WHERE id = ?").bind(id).run();
      }
      return json({ ok: true }, 201);
    },
  ],
];
