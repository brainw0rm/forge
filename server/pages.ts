// Server side of every HTML page. The app is a single-page app, so without this every address would
// return the same empty shell. For each page we work out:
//   - the HTTP status (real 404s for unknown pages, 301s for addresses with a better canonical form),
//   - title, description, canonical address and social preview tags,
//   - "noindex" for private pages (account, sign-in, admin, ...),
//   - structured data (JSON-LD) Google can show in results,
//   - a plain-HTML version of the page's main content for the important pages (items, talents,
//     builds), so search engines index the real text without running JavaScript.
// The app replaces that content block as soon as it starts, so visitors see the normal page.

import { decode } from "../shared/code";
import { QUALITY_NAME, SLOT_NAME, statLine } from "../shared/items";
import { isClassSlug } from "../shared/validate";
import { HttpError, type Env } from "./http";
import { findBuild } from "./routes/builds";

export interface Page {
  status: number;
  /** Full document title; "" means the site's default title. */
  title: string;
  description: string;
  /** Canonical path (no query), or null when the page shouldn't be indexed under any address. */
  canonical: string | null;
  noindex?: boolean;
  image?: string;
  jsonLd?: object[];
  /** HTML for <main id="app"> until the app takes over. */
  body?: string;
  /** Permanent redirect target (path). */
  redirect?: string;
}

export const SITE_NAME = "Forever Forge";
const DEFAULT_TITLE = "Forever Forge · WoW Forever talent calculator, builds and item database";
interface FlightFile {
  nodes: { name: string; zone: string; continent: number; faction: "alliance" | "horde" | "both"; isNew: boolean }[];
}

/** Site-wide preview card (scripts/write-og-default.ts); also used for every page while OG_IMAGES=static. */
const DEFAULT_IMAGE = "/og-default.png";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const PRIVATE = new Set(["account", "admin", "login", "signup", "forgot-password", "reset-password", "verify-email", "unsubscribe"]);

interface ClassFile {
  name: string;
  slug: string;
  trees: { name: string; talents: { id: number; name: string; ranks: string[]; status: string; tier: number }[] }[];
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

/** Works out everything about the page at this address. */
export async function resolvePage(req: Request, env: Env): Promise<Page> {
  const url = new URL(req.url);
  const origin = env.APP_URL ? new URL(env.APP_URL).origin : url.origin;
  const parts = url.pathname.split("/").filter(Boolean);
  const load = assets(env, req);
  const [section, a, b] = parts;

  if (!section) {
    return {
      status: 200,
      title: DEFAULT_TITLE,
      description:
        "WoW Forever talent calculator, community builds, item database and leveling planner, using the actual game data. Tracks every beta build and the live game from launch.",
      canonical: "/",
      jsonLd: [{ "@context": "https://schema.org", "@type": "WebSite", name: SITE_NAME, url: `${origin}/` }],
      body: `<section class="page"><h1>Plan your Forever build from the actual game files</h1>
        <p class="lede">Talent calculator, community builds, item database and planners for World of Warcraft: Forever.</p>
        <ul>${["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"]
          .map((c) => `<li><a href="/talents/${c}">${cap(c)} talent calculator</a></li>`)
          .join("")}</ul></section>`,
    };
  }
  if (PRIVATE.has(section)) {
    return { status: 200, title: "", description: "", canonical: null, noindex: true };
  }

  switch (section) {
    case "talents": {
      if (!a) return { ...notFound(), status: 301, redirect: "/talents/warrior" };
      if (!isClassSlug(a)) return { ...notFound(), status: 301, redirect: "/talents/warrior" };
      const cls = await load<ClassFile>(`/data/classes/${a}.json`);
      if (!cls) return notFound();
      const points = b ? decode(b).length : 0;
      if (points) {
        // Shared build link: its own preview image, but the class page is the one to index.
        return {
          status: 200,
          title: `${cls.name} build (${points} points) · ${SITE_NAME}`,
          description: `A ${cls.name} talent build for World of Warcraft: Forever, level ${9 + points}. Open it in the Forever Forge calculator.`,
          canonical: `/talents/${a}`,
          image: `/og/talents/${a}/${b}.png${url.searchParams.get("b") ? `?b=${encodeURIComponent(url.searchParams.get("b")!)}` : ""}`,
        };
      }
      const changed = cls.trees.flatMap((t) => t.talents).filter((t) => ["new", "reworked", "expanded", "tuned"].includes(t.status)).length;
      return {
        status: 200,
        title: `${cls.name} Talent Calculator for WoW Forever · ${SITE_NAME}`,
        description: `Plan a ${cls.name} build for World of Warcraft: Forever with the real talent trees from the game client: ${cls.trees
          .map((t) => t.name)
          .join(", ")}. ${changed} talents differ from Classic Era.`,
        canonical: `/talents/${a}`,
        jsonLd: [breadcrumbs(origin, [["Talent calculator", "/talents/warrior"], [cls.name, `/talents/${a}`]])],
        body: `<section class="page"><h1>${esc(cls.name)} talent calculator for WoW Forever</h1>
          ${cls.trees
            .map(
              (t) => `<h2>${esc(t.name)}</h2><ul>${[...t.talents]
                .sort((x, y) => x.tier - y.tier)
                .map((tl) => `<li><b>${esc(tl.name)}</b> (${tl.ranks.length} rank${tl.ranks.length > 1 ? "s" : ""}): ${esc(tl.ranks.filter(Boolean).pop() ?? "")}</li>`)
                .join("")}</ul>`,
            )
            .join("")}</section>`,
      };
    }

    case "items": {
      if (!a) {
        return simple("/items", "WoW Forever Item Database", "Search every item in World of Warcraft: Forever: stats, effects, set bonuses and what changed since Classic Era.");
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

    case "builds": {
      if (!a) {
        const { results } = await env.DB.prepare(
          `SELECT b.id, b.title, b.class, b.split, u.username FROM builds b JOIN users u ON u.id = b.user_id
           WHERE b.is_public = 1 AND b.hidden = 0
           ORDER BY (SELECT COUNT(*) FROM ratings r WHERE r.build_id = b.id) DESC, b.updated_at DESC LIMIT 30`,
        ).all<{ id: string; title: string; class: string; split: string; username: string }>();
        return simple("/builds", "WoW Forever Community Builds", "Talent builds for World of Warcraft: Forever, saved and rated by players.", {
          body: `<section class="page"><h1>WoW Forever community builds</h1><ul>${results
            .map((r) => `<li><a href="/builds/${esc(r.id)}">${esc(r.title)}</a>: ${cap(r.class)} ${esc(r.split)} by ${esc(r.username)}</li>`)
            .join("")}</ul></section>`,
        });
      }
      if (b) return notFound();
      try {
        const build = await findBuild(env, a, null);
        const cls = cap(build.class);
        const rating = build.rating_count ? ` Rated ${(build.rating_avg ?? 0).toFixed(1)} of 5 by ${build.rating_count} player${build.rating_count > 1 ? "s" : ""}.` : "";
        return {
          status: 200,
          title: `${build.title}: ${cls} ${build.split} build for WoW Forever · ${SITE_NAME}`,
          description: `${cls} ${build.split} talent build by ${build.username} for World of Warcraft: Forever.${rating}${build.description ? ` ${build.description.slice(0, 160)}` : ""}`,
          canonical: `/builds/${build.id}`,
          image: `/og/build/${build.id}.png?v=${build.updated_at}`,
          jsonLd: [breadcrumbs(origin, [["Community builds", "/builds"], [build.title, `/builds/${build.id}`]])],
          body: `<section class="page"><nav class="crumbs"><a href="/builds">Community builds</a> / ${esc(cls)}</nav>
            <h1>${esc(build.title)}</h1><p>${esc(cls)} ${esc(build.split)} build by ${esc(build.username)}.${esc(rating)}</p>
            ${build.description ? `<p>${esc(build.description)}</p>` : ""}
            <p><a href="/talents/${esc(build.class)}/${esc(build.code)}">Open in the talent calculator</a></p></section>`,
        };
      } catch (err) {
        if (err instanceof HttpError) return notFound(); // private, hidden or missing
        throw err;
      }
    }

    case "changes": {
      if (!a) return simple("/changes", "WoW Forever Talent Changes by Build", "What changed in the talents with each new World of Warcraft: Forever game build, from the beta to the live game.");
      if (a !== "classic") return notFound();
      if (!b) return { ...notFound(), status: 301, redirect: "/changes/classic/warrior" };
      if (!isClassSlug(b) || parts[3]) return notFound();
      const cls = await load<ClassFile>(`/data/classes/${b}.json`);
      if (!cls) return notFound();
      const changed = cls.trees.flatMap((t) => t.talents.map((tl) => ({ ...tl, tree: t.name }))).filter((t) => t.status !== "unchanged" && t.status !== "moved");
      return simple(
        `/changes/classic/${b}`,
        `${cls.name} Talent Changes: Classic vs WoW Forever`,
        `${changed.length} ${cls.name} talents are new or changed in World of Warcraft: Forever compared with Classic Era, with the changed words marked.`,
        {
          body: `<section class="page"><h1>${esc(cls.name)} talent changes: Classic Era vs WoW Forever</h1><ul>${changed
            .map((t) => `<li><b>${esc(t.name)}</b> (${esc(t.tree)}, ${esc(t.status)}): ${esc(t.ranks.filter(Boolean)[0] ?? "")}</li>`)
            .join("")}</ul></section>`,
        },
      );
    }

    case "leveling": {
      if (!a) return { ...notFound(), status: 301, redirect: "/leveling/warrior" };
      if (!isClassSlug(a)) return notFound();
      return simple(`/leveling/${a}`, `${cap(a)} Leveling Planner for WoW Forever`, `Level 1 to 60 as a ${cap(a)} in World of Warcraft: Forever: when each talent point goes in, what the trainer teaches and when dungeons open up.`, b ? { canonical: `/leveling/${a}` } : {});
    }
    case "gear": {
      if (a && (!isClassSlug(a) || b)) return notFound();
      return simple(a ? `/gear/${a}` : "/gear", a ? `${cap(a)} Gear Sandbox for WoW Forever` : "WoW Forever Gear Sandbox", "Equip real World of Warcraft: Forever items and see your character sheet: attack power, crit, spell power and more, with rules of thumb you can change.");
    }
    case "professions": {
      if (!a) return simple("/professions", "WoW Forever Professions & Recipes", "Every World of Warcraft: Forever profession recipe with reagents and skill levels, new recipes marked.");
      const profs = await load<{ slug: string; name: string; recipes: number; new: number }[]>("/data/professions/index.json");
      const prof = profs?.find((p) => p.slug === a);
      if (!prof || b) return notFound();
      return simple(`/professions/${a}`, `${prof.name} Recipes in WoW Forever`, `All ${prof.recipes} ${prof.name} recipes in World of Warcraft: Forever with reagents and skill levels. ${prof.new} are new compared with Classic Era.`);
    }
    case "legacy":
      return simple("/legacy", "WoW Forever Legacy Planner", "Plan your account-wide Legacy points in World of Warcraft: Forever and see where to earn more.", a ? { canonical: "/legacy" } : {});
    case "compare":
      return simple("/compare", "Compare WoW Forever Builds", "Put two World of Warcraft: Forever talent builds side by side and see where they differ.", a ? { canonical: "/compare" } : {});
    case "news":
      return a ? notFound() : simple("/news", "WoW Forever News", "World of Warcraft: Forever news headlines from Wowhead, MMO-Champion, Blizzard Watch, PC Gamer and buffed.de.");
    case "flights": {
      const continents: Record<string, { id: number; name: string }> = { "eastern-kingdoms": { id: 0, name: "Eastern Kingdoms" }, kalimdor: { id: 1, name: "Kalimdor" } };
      if (!a || !continents[a]) return { ...notFound(), status: 301, redirect: "/flights/eastern-kingdoms" };
      if (b) return notFound();
      const cont = continents[a];
      const data = await load<FlightFile>("/data/flights.json");
      const nodes = (data?.nodes ?? []).filter((n) => n.continent === cont.id);
      const fresh = nodes.filter((n) => n.isNew);
      const zones = [...new Set(nodes.map((n) => n.zone))].sort();
      return simple(
        `/flights/${a}`,
        `${cont.name} Flight Paths in WoW Forever`,
        `Flight map and route planner for ${cont.name} in World of Warcraft: Forever: all ${nodes.length} flight points with routes and prices.${
          fresh.length ? ` ${fresh.length} are new: ${[...new Set(fresh.map((n) => n.name))].join(", ")}.` : ""
        }`,
        {
          body: `<section class="page"><h1>${esc(cont.name)} flight paths in WoW Forever</h1>${zones
            .map(
              (z) => `<h2>${esc(z)}</h2><ul>${nodes
                .filter((n) => n.zone === z)
                .map((n) => `<li>${esc(n.name)} (${n.faction === "both" ? "both factions" : n.faction === "alliance" ? "Alliance" : "Horde"}${n.isNew ? ", new in Forever" : ""})</li>`)
                .join("")}</ul>`,
            )
            .join("")}</section>`,
        },
      );
    }
    case "races":
      return a ? notFound() : simple("/races", "WoW Forever Race & Class Combinations", "Which races can play which classes in World of Warcraft: Forever, with the combinations that are new since Classic Era.");
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
  const image = env.OG_IMAGES === "static" || !page.image ? DEFAULT_IMAGE : page.image;
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

/** XML sitemap of public community builds (the static sitemaps cover everything else). It always lists
 * the builds overview too, so it's never an empty <urlset> (which the sitemap schema doesn't allow). */
export async function buildsSitemap(env: Env, req: Request): Promise<Response> {
  const origin = env.APP_URL ? new URL(env.APP_URL).origin : new URL(req.url).origin;
  const { results } = await env.DB.prepare(
    "SELECT id, updated_at FROM builds WHERE is_public = 1 AND hidden = 0 ORDER BY updated_at DESC LIMIT 50000",
  ).all<{ id: string; updated_at: number }>();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${origin}/builds</loc></url>
${results.map((r) => `  <url><loc>${origin}/builds/${r.id}</loc><lastmod>${new Date(r.updated_at).toISOString().slice(0, 10)}</lastmod></url>`).join("\n")}
</urlset>
`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
