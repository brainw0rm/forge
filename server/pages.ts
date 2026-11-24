// Server side of every HTML page. The app is a single-page app, so without this every address would
// return the same empty shell. For each page we work out:
//   - the HTTP status (real 404s for unknown pages, 410 for retired tools),
//   - title, description, canonical address and social preview tags,
//   - structured data (JSON-LD) Google can show in results,
//   - a plain-HTML version of the page's main content for the important pages (professions,
//     recipes, items), so search engines index the real text without running JavaScript.
// The app replaces that content block as soon as it starts, so visitors see the normal page.

import { QUALITY_NAME, SLOT_NAME, statLine } from "../shared/items";
import { type Env } from "./http";

export interface Page {
  status: number;
  /** Full document title; "" means the site's default title. */
  title: string;
  description: string;
  /** Canonical path (no query), or null when the page shouldn't be indexed under any address. */
  canonical: string | null;
  noindex?: boolean;
  jsonLd?: object[];
  /** HTML for <main id="app"> until the app takes over. */
  body?: string;
  /** Permanent redirect target (path). */
  redirect?: string;
}

export const SITE_NAME = "Forever Forge";
const DEFAULT_TITLE = "Forever Forge · WoW Forever crafting recipes and profession guide";

/** Site-wide preview card (scripts/write-og-default.ts). */
const DEFAULT_IMAGE = "/og-default.png";

/** Tools the site had before it became a crafting companion (November 2026). */
export const RETIRED = new Set([
  "talents", "builds", "gear", "sets", "flights", "leveling", "legacy", "compare", "changes", "news", "races",
  "account", "admin", "login", "signup", "forgot-password", "reset-password", "verify-email", "unsubscribe",
]);

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

interface ItemRefDoc {
  id: number;
  name: string;
  count?: number;
}
interface RecipeDoc {
  spell: number;
  name: string;
  learn?: number;
  creates: ItemRefDoc | null;
  reagents: ItemRefDoc[];
  desc?: string;
  tools?: string[];
  station?: string;
  new?: true;
}
interface ProfessionDoc {
  slug: string;
  name: string;
  kind: string;
  desc: string;
  recipes: RecipeDoc[];
}
interface ProfessionIndex {
  slug: string;
  name: string;
  kind: string;
  recipes: number;
  new: number;
}
interface ItemDoc {
  id: number;
  name: string;
  q: number;
  ilvl: number;
  req: number;
  cls: number;
  sub: number;
  slot: number;
  stats: Record<string, number>;
  armor?: number;
  dmg?: { min: number; max: number; speed: number; dps: number } | null;
  spells?: { on: string; text: string }[];
  flavor?: string;
  set?: { name: string };
  status: "new" | "changed" | "same";
}

function assets(env: Env, req: Request) {
  return async <T>(path: string): Promise<T | null> => {
    if (!env.ASSETS) return null;
    const res = await env.ASSETS.fetch(new URL(path, req.url).toString());
    return res.ok ? ((await res.json()) as T) : null;
  };
}

const notFound = (): Page => ({
  status: 404,
  title: `Page not found · ${SITE_NAME}`,
  description: "That page doesn't exist on Forever Forge.",
  canonical: null,
  noindex: true,
  body: `<section class="page"><div class="empty"><h1>Page not found</h1><p>That page doesn't exist.</p><a class="btn" href="/">Go home</a></div></section>`,
});

const retired = (): Page => ({
  status: 410,
  title: `Retired tool · ${SITE_NAME}`,
  description: "Forever Forge is now a crafting companion for WoW Forever; this tool was retired.",
  canonical: null,
  noindex: true,
  body: `<section class="page"><div class="empty"><h1>This tool was retired</h1>
    <p>Forever Forge is now a crafting companion: every recipe of every profession in WoW Forever.</p><a class="btn" href="/">Browse professions</a></div></section>`,
});

const simple = (path: string, title: string, description: string, extra: Partial<Page> = {}): Page => ({
  status: 200,
  title: `${title} · ${SITE_NAME}`,
  description,
  canonical: path,
  body: `<section class="page"><h1>${esc(title)}</h1><p class="lede">${esc(description)}</p></section>`,
  ...extra,
});

function breadcrumbs(origin: string, trail: [string, string][]): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: origin + path })),
  };
}

const amount = (i: ItemRefDoc) => `${i.count && i.count > 1 ? `${i.count}× ` : ""}${i.name}`;

/** Works out everything about the page at this address. */
export async function resolvePage(req: Request, env: Env): Promise<Page> {
  const url = new URL(req.url);
  const origin = env.APP_URL ? new URL(env.APP_URL).origin : url.origin;
  const parts = url.pathname.split("/").filter(Boolean);
  const load = assets(env, req);
  const [section, a, b, c] = parts;

  async function profession(slug: string, spell?: string, extra?: string): Promise<Page> {
    if (!/^[a-z-]{2,30}$/.test(slug) || extra) return notFound();
    const prof = await load<ProfessionDoc>(`/data/professions/${slug}.json`);
    if (!prof) return notFound();
    if (!spell) {
      return {
        status: 200,
        title: `${prof.name} Recipes & Guide for WoW Forever · ${SITE_NAME}`,
        description: `All ${prof.recipes.length} ${prof.name} recipes in World of Warcraft: Forever with reagents, skill levels, tools and recipe items. ${prof.desc}`,
        canonical: `/professions/${slug}`,
        jsonLd: [breadcrumbs(origin, [["Professions", "/professions"], [prof.name, `/professions/${slug}`]])],
        body: `<section class="page"><h1>${esc(prof.name)} in WoW Forever</h1><p class="lede">${esc(prof.desc)}</p>
          <ul>${prof.recipes
            .map((r) => `<li><a href="/professions/${slug}/${r.spell}">${esc(r.name)}</a>${r.learn ? ` (skill ${r.learn})` : ""}: ${esc(r.reagents.map(amount).join(", "))}</li>`)
            .join("")}</ul></section>`,
      };
    }
    const r = /^\d{1,8}$/.test(spell) ? prof.recipes.find((x) => x.spell === Number(spell)) : undefined;
    if (!r) return notFound();
    const needs = [r.reagents.map(amount).join(", "), r.tools?.length ? `tools: ${r.tools.join(", ")}` : "", r.station ? `at a ${r.station}` : ""]
      .filter(Boolean)
      .join("; ");
    return {
      status: 200,
      title: `${r.name} (${prof.name} recipe, WoW Forever) · ${SITE_NAME}`,
      description: `${prof.name} recipe ${r.name}${r.learn ? `, learned at skill ${r.learn}` : ""}. Reagents: ${needs || "none"}.${
        r.creates ? ` Creates ${amount(r.creates)}.` : r.desc ? ` ${r.desc}` : ""
      }${r.new ? " New in WoW Forever." : ""}`,
      canonical: `/professions/${slug}/${r.spell}`,
      jsonLd: [breadcrumbs(origin, [["Professions", "/professions"], [prof.name, `/professions/${slug}`], [r.name, `/professions/${slug}/${r.spell}`]])],
      body: `<section class="page"><nav><a href="/professions/${slug}">${esc(prof.name)}</a></nav><h1>${esc(r.name)}</h1>
        <p>${esc(prof.name)} recipe${r.learn ? `, learned at skill ${r.learn}` : ""}.</p>
        <h2>Reagents</h2><ul>${r.reagents.map((i) => `<li><a href="/items/${i.id}">${esc(amount(i))}</a></li>`).join("")}</ul>
        ${r.creates ? `<p>Creates <a href="/items/${r.creates.id}">${esc(amount(r.creates))}</a>.</p>` : r.desc ? `<p>${esc(r.desc)}</p>` : ""}</section>`,
    };
  }

  if (!section || section === "professions") {
    if (a) return profession(a, b, c);
    const list = (await load<ProfessionIndex[]>("/data/professions/index.json")) ?? [];
    const total = list.reduce((n, p) => n + p.recipes, 0);
    return {
      status: 200,
      title: section ? `WoW Forever Professions · ${SITE_NAME}` : DEFAULT_TITLE,
      description: `Every crafting recipe in World of Warcraft: Forever, ${total} across ${list.length} professions, straight from the game client: reagents, skill levels, tools, recipe items and what changed since Classic Era.`,
      canonical: section ? "/professions" : "/",
      jsonLd: section ? [] : [{ "@context": "https://schema.org", "@type": "WebSite", name: SITE_NAME, url: `${origin}/` }],
      body: `<section class="page"><h1>Every crafting recipe in WoW Forever</h1>
        <p class="lede">Recipes, reagents, skill levels and recipe items for every profession, from the game client.</p>
        <ul>${list.map((p) => `<li><a href="/professions/${p.slug}">${esc(p.name)}</a>: ${p.recipes} recipes${p.new ? `, ${p.new} new in Forever` : ""}</li>`).join("")}</ul></section>`,
    };
  }
  if (RETIRED.has(section)) return retired();

  switch (section) {
    case "items": {
      if (!a) {
        return simple("/items", "WoW Forever Item Database", "Search every item in World of Warcraft: Forever: crafting materials, recipe items, gear and what changed since Classic Era.");
      }
      if (!/^\d{1,7}$/.test(a) || b) return notFound();
      const meta = await load<{ shards: number; classes: { id: number; name: string; subs: { id: number; name: string }[] }[] }>("/data/items/db/meta.json");
      const item = meta ? (await load<Record<string, ItemDoc>>(`/data/items/db/d/${Number(a) % meta.shards}.json`))?.[a] : null;
      if (!item || !meta) return notFound();
      const cls = meta.classes.find((c) => c.id === item.cls);
      const sub = cls?.subs.find((s) => s.id === item.sub)?.name;
      const type = [QUALITY_NAME[item.q], SLOT_NAME[item.slot], sub && sub !== cls?.name ? sub : cls?.name].filter(Boolean).join(" ");
      const lines = [
        item.dmg ? `${item.dmg.min} - ${item.dmg.max} Damage, Speed ${item.dmg.speed.toFixed(2)} (${item.dmg.dps.toFixed(1)} damage per second)` : "",
        item.armor ? `${item.armor} Armor` : "",
        ...Object.entries(item.stats).map(([k, v]) => statLine(k, v)),
        item.req > 1 ? `Requires Level ${item.req}` : "",
        ...(item.spells ?? []).map((s) => `${s.on === "hit" ? "Chance on hit" : cap(s.on)}: ${s.text.replace(/\s+/g, " ")}`),
        item.set ? `Part of the set ${item.set.name}` : "",
      ].filter(Boolean);
      const status = { new: "New in WoW Forever.", changed: "Changed since Classic Era.", same: "Same as in Classic Era." }[item.status];
      return {
        status: 200,
        title: `${item.name} (WoW Forever item) · ${SITE_NAME}`,
        description: `${type}, item level ${item.ilvl}. ${lines.slice(0, 4).join(" · ")}. ${status}`,
        canonical: `/items/${a}`,
        jsonLd: [
          breadcrumbs(origin, [
            ["Items", "/items"],
            ...(cls ? ([[cls.name, `/items?type=${cls.id}`]] as [string, string][]) : []),
            [item.name, `/items/${a}`],
          ]),
        ],
        body: `<section class="page"><nav class="crumbs"><a href="/items">Items</a>${cls ? ` / ${esc(cls.name)}` : ""}</nav>
          <h1>${esc(item.name)}</h1><p>${esc(type)} · item level ${item.ilvl}</p>
          <ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
          ${item.flavor ? `<p><i>“${esc(item.flavor)}”</i></p>` : ""}<p>${esc(status)}</p></section>`,
      };
    }

    case "list":
      return a ? notFound() : simple("/list", "Crafting list", "Plan what to craft in World of Warcraft: Forever and get the full shopping list of reagents.");
    case "moderate":
      return { status: 200, title: "", description: "", canonical: null, noindex: true };
    case "privacy":
      return a ? notFound() : simple("/privacy", "Privacy policy", "How Forever Forge handles your data.");
    case "imprint":
      return a ? notFound() : simple("/imprint", "Imprint", "Who runs Forever Forge.");
    default:
      return notFound();
  }
}

export interface PageHtml {
  status: number;
  title: string;
  description: string;
  ogUrl: string;
  /** Tags appended to <head>. */
  head: string;
  body?: string;
  noindex: boolean;
}

/** Everything renderPage writes into the shell, as plain data (testable without HTMLRewriter). */
export function pageHtml(page: Page, req: Request, env: Env): PageHtml {
  const url = new URL(req.url);
  const origin = env.APP_URL ? new URL(env.APP_URL).origin : url.origin;
  // Only the canonical host is indexable (preview deployments are for testing).
  const offHost = env.APP_URL ? url.hostname !== new URL(env.APP_URL).hostname : false;
  const noindex = !!page.noindex || offHost;
  const oneLine = (s: string, max: number) => {
    const t = s.replace(/\s+/g, " ").trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  };
  const title = oneLine(page.title, 120);
  const description = oneLine(page.description, 300);
  const abs = (p: string) => new URL(p, origin).toString();
  const image = DEFAULT_IMAGE;
  const head = [
    noindex ? `<meta name="robots" content="noindex" />` : "",
    page.canonical && !noindex ? `<link rel="canonical" href="${esc(abs(page.canonical))}" />` : "",
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta property="og:image" content="${esc(abs(image))}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:image" content="${esc(abs(image))}" />`,
    title ? `<meta name="twitter:title" content="${esc(title.replace(/ · Forever Forge$/, ""))}" />` : "",
    description ? `<meta name="twitter:description" content="${esc(description)}" />` : "",
    ...(page.jsonLd ?? []).map((d) => `<script type="application/ld+json">${JSON.stringify(d).replace(/</g, "\\u003c")}</script>`),
  ]
    .filter(Boolean)
    .join("\n    ");
  return { status: page.status, title, description, ogUrl: page.canonical ? abs(page.canonical) : url.toString(), head, body: page.body, noindex };
}

/** Serves the app shell with the page's status, head tags and pre-rendered content. */
export async function renderPage(req: Request, env: Env): Promise<Response> {
  const page = await resolvePage(req, env);
  const url = new URL(req.url);
  const origin = env.APP_URL ? new URL(env.APP_URL).origin : url.origin;
  if (page.redirect) return Response.redirect(origin + page.redirect + url.search, 301);
  const html = pageHtml(page, req, env);
  const shell = await env.ASSETS!.fetch(new URL("/", req.url).toString());
  const set = (content: string) => ({
    element: (el: Element) => {
      el.setAttribute("content", content);
    },
  });
  let rewriter = new HTMLRewriter().on("head", {
    element: (el) => {
      el.append(html.head, { html: true });
    },
  });
  if (html.title) {
    rewriter = rewriter
      .on("title", { element: (el) => void el.setInnerContent(html.title) })
      .on('meta[property="og:title"]', set(html.title.replace(/ · Forever Forge$/, "")));
  }
  if (html.description) rewriter = rewriter.on('meta[name="description"]', set(html.description)).on('meta[property="og:description"]', set(html.description));
  rewriter = rewriter.on('meta[property="og:url"]', set(html.ogUrl));
  if (html.body) rewriter = rewriter.on("main#app", { element: (el) => void el.setInnerContent(html.body!, { html: true }) });
  const res = rewriter.transform(shell);
  const headers = new Headers(res.headers);
  if (html.noindex) headers.set("X-Robots-Tag", "noindex");
  return new Response(res.body, { status: html.status, headers });
}
