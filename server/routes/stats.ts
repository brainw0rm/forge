// Aggregate talent popularity across public builds (no per-user data leaves the server).

import { decode } from "../../shared/code";
import { isClassSlug } from "../../shared/validate";
import { fail, json, type Route } from "../http";

/** Levels at which the leveling-order prefix of each build is sampled. */
export const BRACKETS = [20, 30, 40, 50] as const;
const FIRST_TALENT_LEVEL = 10;
const CACHE_SECONDS = 300;

export interface TalentStats {
  class: string;
  /** Public builds counted. */
  builds: number;
  /** Talent node id -> number of builds with at least one point in it (whole build). */
  picks: Record<number, number>;
  /** Same, using only the points spent by each level; `builds` counts builds that reached it. */
  brackets: { level: number; builds: number; picks: Record<number, number> }[];
}

export function talentStats(cls: string, codes: string[]): TalentStats {
  const picks: Record<number, number> = {};
  const brackets = BRACKETS.map((level) => ({ level, builds: 0, picks: {} as Record<number, number> }));
  for (const code of codes) {
    const order = decode(code);
    for (const id of new Set(order)) picks[id] = (picks[id] ?? 0) + 1;
    for (const b of brackets) {
      const points = b.level - FIRST_TALENT_LEVEL + 1;
      if (order.length < points) continue;
      b.builds++;
      for (const id of new Set(order.slice(0, points))) b.picks[id] = (b.picks[id] ?? 0) + 1;
    }
  }
  return { class: cls, builds: codes.length, picks, brackets };
}

export const statsRoutes: Route[] = [
  [
    "GET",
    /^\/stats\/talents$/,
    async (req, env) => {
      const cls = new URL(req.url).searchParams.get("class") ?? "";
      if (!isClassSlug(cls)) fail(400, "Unknown class.");
      // Cache per class at the edge; popularity doesn't need to be up to the second.
      const cache = typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined;
      const key = new Request(new URL(`/api/stats/talents?class=${cls}`, req.url).toString());
      const hit = await cache?.match(key).catch(() => undefined);
      if (hit) return hit;
      const { results } = await env.DB.prepare("SELECT code FROM builds WHERE class = ? AND is_public = 1 AND hidden = 0")
        .bind(cls)
        .all<{ code: string }>();
      const res = json(talentStats(cls, results.map((r) => r.code)), 200, {
        "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
      });
      await cache?.put(key, res.clone()).catch(() => undefined);
      return res;
    },
  ],
];
