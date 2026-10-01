// News headlines about WoW Forever. scripts/fetch-news.ts reads the publishers' feeds (on a
// schedule, in GitHub Actions) and posts the matching headlines here; the site only reads them.

import { MAX_TITLE, NEWS_SOURCES, canonicalUrl, sourceById, type NewsItem } from "../../shared/news";
import { body, fail, json, str, type Route } from "../http";
import { requireAdmin } from "./admin";

const PAGE = 30;
const MAX_INGEST = 400;
const CACHE_SECONDS = 300;

interface NewsRow {
  url: string;
  source: string;
  title: string;
  published_at: number;
  hidden: number;
}

const toItem = (r: NewsRow) => ({ url: r.url, source: r.source, title: r.title, published: r.published_at, ...(r.hidden ? { hidden: true } : {}) });

/** Re-checks everything the ingest job sends: known source, link on that source's host, sane title and date. */
function readItem(raw: unknown, now: number): NewsItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const source = sourceById(str(r.source));
  const title = str(r.title).replace(/\s+/g, " ").trim();
  const published = Number(r.published);
  if (!source || !title || title.length > MAX_TITLE || !Number.isFinite(published)) return null;
  const url = canonicalUrl(str(r.url), source);
  if (!url || url.length > 600) return null;
  return { source: source.id, title, url, published: Math.min(published, now) };
}

export const newsRoutes: Route[] = [
  [
    "GET",
    /^\/news$/,
    async (req, env) => {
      const q = new URL(req.url).searchParams;
      const lang = q.get("lang");
      const source = q.get("source");
      const before = Number(q.get("before")) || Number.MAX_SAFE_INTEGER;
      const limit = Math.min(Math.max(Number(q.get("limit")) || PAGE, 1), PAGE);
      const sources = NEWS_SOURCES.map(({ id, name, site, lang }) => ({ id, name, site, lang }));
      const ids = NEWS_SOURCES.filter((s) => (!lang || s.lang === lang) && (!source || s.id === source)).map((s) => s.id);
      if (!ids.length) return json({ items: [], hasMore: false, sources, updatedAt: null });
      const { results } = await env.DB.prepare(
        `SELECT url, source, title, published_at, hidden FROM news_items
         WHERE hidden = 0 AND published_at < ? AND source IN (${ids.map(() => "?").join(",")})
         ORDER BY published_at DESC LIMIT ?`,
      )
        .bind(before, ...ids, limit + 1)
        .all<NewsRow>();
      const updated = await env.DB.prepare("SELECT value FROM job_state WHERE key = 'news_updated_at'").first<{ value: string }>();
      return json(
        {
          items: results.slice(0, limit).map(toItem),
          hasMore: results.length > limit,
          sources,
          updatedAt: updated ? Number(updated.value) : null,
        },
        200,
        { "Cache-Control": `public, max-age=${CACHE_SECONDS}` },
      );
    },
  ],
  [
    "POST",
    /^\/internal\/news$/,
    async (req, env) => {
      // Called by the scheduled fetch job (scripts/fetch-news.ts).
      const auth = req.headers.get("Authorization") ?? "";
      if (!env.NOTIFY_SECRET || auth !== `Bearer ${env.NOTIFY_SECRET}`) fail(401, "Not allowed.");
      const input = await body<{ items?: unknown }>(req);
      const raw = Array.isArray(input.items) ? (input.items as unknown[]) : null;
      if (!raw || raw.length > MAX_INGEST) return fail(400, `Send up to ${MAX_INGEST} items.`);
      const now = Date.now();
      const items = raw.map((i) => readItem(i, now)).filter((i): i is NewsItem => i !== null);
      // Title and date may be corrected by the publisher; the hidden flag is never touched here.
      const upsert = env.DB.prepare(
        `INSERT INTO news_items (url, source, title, published_at, first_seen) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (url) DO UPDATE SET title = excluded.title, published_at = excluded.published_at`,
      );
      const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM news_items").first<{ n: number }>();
      if (items.length) await env.DB.batch(items.map((i) => upsert.bind(i.url, i.source, i.title, i.published, now)));
      await env.DB.prepare(
        "INSERT INTO job_state (key, value) VALUES ('news_updated_at', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      )
        .bind(String(now))
        .run();
      const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM news_items").first<{ n: number }>();
      return json({ received: raw.length, accepted: items.length, added: (after?.n ?? 0) - (before?.n ?? 0) });
    },
  ],
  [
    "GET",
    /^\/admin\/news$/,
    async (req, env) => {
      await requireAdmin(env, req);
      const { results } = await env.DB.prepare(
        "SELECT url, source, title, published_at, hidden FROM news_items ORDER BY published_at DESC LIMIT 200",
      ).all<NewsRow>();
      return json({ items: results.map(toItem) });
    },
  ],
  [
    "POST",
    /^\/admin\/news\/(hide|unhide)$/,
    async (req, env, [action]) => {
      await requireAdmin(env, req);
      const { url } = await body<{ url?: unknown }>(req);
      const res = await env.DB.prepare("UPDATE news_items SET hidden = ? WHERE url = ?")
        .bind(action === "hide" ? 1 : 0, str(url))
        .run();
      if (!res.meta.changes) fail(404, "No such headline.");
      return json({ ok: true });
    },
  ],
];
