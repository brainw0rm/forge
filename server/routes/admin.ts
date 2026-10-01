// Moderation queue for admins. Make someone an admin with:
//   npx wrangler d1 execute forever-forge --remote --command "UPDATE users SET role = 'admin' WHERE username = 'you'"

import { userFromRequest, type SessionUser } from "../auth";
import { body, fail, json, str, type Env, type Route } from "../http";
import { BUILD_SELECT, deleteBuild, findBuild, toBuild, type BuildRow } from "./builds";

export async function requireAdmin(env: Env, req: Request): Promise<SessionUser> {
  const user = await userFromRequest(env.DB, req);
  if (!user) fail(401, "Sign in to do that.");
  if (user!.role !== "admin") fail(403, "Moderators only.");
  return user!;
}

interface ReportRow {
  build_id: string;
  reason: string;
  details: string;
  created_at: number;
  reporter: string;
}

const ACTIONS = ["dismiss", "hide", "unhide", "delete"] as const;

export const adminRoutes: Route[] = [
  [
    "GET",
    /^\/admin\/reports$/,
    async (req, env) => {
      const admin = await requireAdmin(env, req);
      // Builds with open reports first (most reported first), then builds that are hidden without open reports.
      const { results: builds } = await env.DB.prepare(
        `${BUILD_SELECT}
         WHERE b.id IN (SELECT build_id FROM reports WHERE resolved_at IS NULL) OR b.hidden = 1
         ORDER BY (SELECT COUNT(*) FROM reports p WHERE p.build_id = b.id AND p.resolved_at IS NULL) DESC, b.updated_at DESC
         LIMIT 100`,
      )
        .bind(admin.id)
        .all<BuildRow>();
      const { results: reports } = await env.DB.prepare(
        `SELECT p.build_id, p.reason, p.details, p.created_at, u.username AS reporter
         FROM reports p JOIN users u ON u.id = p.reporter_id
         WHERE p.resolved_at IS NULL ORDER BY p.created_at`,
      ).all<ReportRow>();
      return json({
        queue: builds.map((b) => ({
          build: toBuild(b, admin),
          reports: reports
            .filter((r) => r.build_id === b.id)
            .map((r) => ({ reason: r.reason, details: r.details, reporter: r.reporter, createdAt: r.created_at })),
        })),
      });
    },
  ],
  [
    "POST",
    /^\/admin\/builds\/([A-Za-z0-9]{6,16})\/moderate$/,
    async (req, env, [id]) => {
      const admin = await requireAdmin(env, req);
      await findBuild(env, id, admin);
      const action = str((await body<{ action?: unknown }>(req)).action);
      if (!(ACTIONS as readonly string[]).includes(action)) fail(400, "Unknown action.");
      const now = Date.now();
      const resolve = (resolution: string) =>
        env.DB.prepare("UPDATE reports SET resolved_at = ?, resolution = ? WHERE build_id = ? AND resolved_at IS NULL").bind(
          now,
          resolution,
          id,
        );
      if (action === "delete") {
        await deleteBuild(env, id);
      } else if (action === "dismiss") {
        await env.DB.batch([resolve("dismissed"), env.DB.prepare("UPDATE builds SET hidden = 0 WHERE id = ?").bind(id)]);
      } else if (action === "hide") {
        await env.DB.batch([resolve("hidden"), env.DB.prepare("UPDATE builds SET hidden = 1 WHERE id = ?").bind(id)]);
      } else {
        await env.DB.prepare("UPDATE builds SET hidden = 0 WHERE id = ?").bind(id).run();
      }
      return json({ ok: true });
    },
  ],
];
