// Server-side <head> tags for shareable pages. The app is a single-page app, so crawlers
// (Discord, Slack, X, search engines) only see these if they are in the served HTML.

import { isClassSlug } from "../shared/validate";
import { decode } from "../shared/code";
import { QUALITY_NAME, SLOT_NAME, statLine } from "../shared/items";
import { HttpError, type Env } from "./http";
import { findBuild } from "./routes/builds";

export interface PageMeta {
  title: string;
  description: string;
  image?: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Serve the SPA's index.html with page-specific title, description and social tags. */
export async function withMeta(req: Request, env: Env, raw: PageMeta | null): Promise<Response> {
  const page = await env.ASSETS!.fetch(new URL("/", req.url).toString());
  if (!raw) return page;
  // One line each (user descriptions contain line breaks), and short enough for link previews.
  const oneLine = (s: string, max: number) => {
    const t = s.replace(/\s+/g, " ").trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  };
  const meta = { ...raw, title: oneLine(raw.title, 110), description: oneLine(raw.description, 300) };
  const url = new URL(req.url);
  const abs = (p: string) => new URL(p, url.origin).toString();
  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Forever Forge" />`,
    `<meta name="twitter:card" content="${meta.image ? "summary_large_image" : "summary"}" />`,
    ...(meta.image
      ? [
          `<meta property="og:image" content="${esc(abs(meta.image))}" />`,
          `<meta property="og:image:width" content="1200" />`,
          `<meta property="og:image:height" content="630" />`,
          `<meta name="twitter:image" content="${esc(abs(meta.image))}" />`,
        ]
      : []),
    `<meta name="twitter:title" content="${esc(meta.title)}" />`,
    `<meta name="twitter:description" content="${esc(meta.description)}" />`,
  ].join("\n    ");
  const setContent = (content: string) => ({
    element: (el: Element) => {
      el.setAttribute("content", content);
    },
  });
  return new HTMLRewriter()
    .on("title", {
      element: (el) => {
        el.setInnerContent(`${meta.title} · Forever Forge`);
      },
    })
    .on('meta[name="description"]', setContent(meta.description))
    .on('meta[property="og:title"]', setContent(meta.title))
    .on('meta[property="og:description"]', setContent(meta.description))
    .on('meta[property="og:url"]', setContent(url.toString()))
    .on("head", {
      element: (el) => {
        el.append(tags, { html: true });
      },
    })
    .transform(page);
}

export async function buildPageMeta(env: Env, id: string): Promise<PageMeta | null> {
  try {
    const b = await findBuild(env, id, null);
    const rating = b.rating_count ? ` · ${(b.rating_avg ?? 0).toFixed(1)}★ from ${b.rating_count} rating${b.rating_count > 1 ? "s" : ""}` : "";
    const cls = b.class[0].toUpperCase() + b.class.slice(1);
    return {
      title: `${b.title} (${cls} ${b.split})`,
      description: `${cls} ${b.split} build by ${b.username} for World of Warcraft: Forever${rating}.${b.description ? ` ${b.description.slice(0, 160)}` : ""}`,
      image: `/og/build/${b.id}.png?v=${b.updated_at}`,
    };
  } catch (err) {
    if (err instanceof HttpError) return null; // private, hidden or missing: no preview
    throw err;
  }
}

export function talentsPageMeta(url: URL): PageMeta | null {
  const [, , slug, code] = url.pathname.split("/");
  if (!slug || !isClassSlug(slug)) return null;
  const cls = slug[0].toUpperCase() + slug.slice(1);
  const points = code ? decode(code).length : 0;
  if (!points) {
    return { title: `${cls} talent calculator`, description: `Plan a ${cls} build for World of Warcraft: Forever with live game talent data.` };
  }
  const b = url.searchParams.get("b");
  return {
    title: `${cls} build (${points} points)`,
    description: `A ${cls} talent build for World of Warcraft: Forever, level ${9 + points}. Open it in the Forever Forge calculator.`,
    image: `/og/talents/${slug}/${code}.png${b ? `?b=${encodeURIComponent(b)}` : ""}`,
  };
}

interface ItemMetaData {
  name: string;
  q: number;
  ilvl: number;
  req: number;
  slot: number;
  stats: Record<string, number>;
  armor?: number;
  dmg?: { min: number; max: number; speed: number } | null;
  spells?: { on: string; text: string }[];
  status: "new" | "changed" | "same";
}

/** /items/<id>: the item's name and a one-line tooltip summary for link previews. */
export async function itemPageMeta(req: Request, env: Env): Promise<PageMeta | null> {
  const m = /^\/items\/(\d{1,7})\/?$/.exec(new URL(req.url).pathname);
  if (!m || !env.ASSETS) return null;
  const get = async <T>(path: string) => {
    const res = await env.ASSETS!.fetch(new URL(path, req.url).toString());
    return res.ok ? ((await res.json()) as T) : null;
  };
  const meta = await get<{ shards: number }>("/data/items/db/meta.json");
  if (!meta) return null;
  const item = (await get<Record<string, ItemMetaData>>(`/data/items/db/d/${Number(m[1]) % meta.shards}.json`))?.[m[1]];
  if (!item) return null;
  const parts = [
    [QUALITY_NAME[item.q], SLOT_NAME[item.slot]].filter(Boolean).join(" "),
    `item level ${item.ilvl}`,
    item.req > 1 ? `requires level ${item.req}` : "",
    item.dmg ? `${item.dmg.min}–${item.dmg.max} damage, speed ${item.dmg.speed.toFixed(2)}` : "",
    item.armor ? `${item.armor} armor` : "",
    ...Object.entries(item.stats).map(([k, v]) => statLine(k, v)),
  ].filter(Boolean);
  const status = { new: "New in WoW Forever.", changed: "Changed since Classic Era.", same: "Same as in Classic Era." }[item.status];
  const effects = (item.spells ?? [])
    .slice(0, 2)
    .map((s) => `${s.on === "hit" ? "Chance on hit" : s.on[0].toUpperCase() + s.on.slice(1)}: ${s.text.replace(/\s+/g, " ")}`);
  let description = [`${parts.join(" · ")}.`, status, ...effects].join(" ");
  if (description.length > 300) description = `${description.slice(0, 297)}…`;
  return { title: item.name, description };
}
