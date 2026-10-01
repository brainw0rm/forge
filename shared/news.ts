// News headlines about WoW Forever, read from the RSS/Atom feeds the publishers offer for syndication.
//
// Copyright stance (see README, "News"): we keep only what's needed to point readers to the
// original article: headline, link, publisher name, publication date. No article text, no feed
// summaries, no images, no publisher logos. Links go straight to the publisher's page.
// Used by scripts/fetch-news.ts (parsing) and server/routes/news.ts (validation).

export interface NewsSource {
  id: string;
  name: string;
  /** Home page, linked from the source list. */
  site: string;
  feed: string;
  lang: "en" | "de";
  /** Hosts article links may point to; anything else in the feed is dropped. */
  hosts: string[];
}

/** Publishers whose public feeds we read. Remove an entry to honor an opt-out request. */
export const NEWS_SOURCES: NewsSource[] = [
  {
    id: "wowhead",
    name: "Wowhead",
    site: "https://www.wowhead.com/classic/news",
    feed: "https://www.wowhead.com/news/rss/all",
    lang: "en",
    hosts: ["www.wowhead.com"],
  },
  {
    id: "mmo-champion",
    name: "MMO-Champion",
    site: "https://www.mmo-champion.com/",
    feed: "https://www.mmo-champion.com/external.php?do=rss&type=newcontent&sectionid=1&days=120&count=10",
    lang: "en",
    hosts: ["www.mmo-champion.com"],
  },
  {
    id: "blizzard-watch",
    name: "Blizzard Watch",
    site: "https://blizzardwatch.com/",
    feed: "https://blizzardwatch.com/category/world-of-warcraft/feed/",
    lang: "en",
    hosts: ["blizzardwatch.com"],
  },
  {
    id: "massively-op",
    name: "Massively Overpowered",
    site: "https://massivelyop.com/",
    feed: "https://massivelyop.com/tag/wow-forever/feed/",
    lang: "en",
    hosts: ["massivelyop.com"],
  },
  {
    id: "pc-gamer",
    name: "PC Gamer",
    site: "https://www.pcgamer.com/",
    feed: "https://www.pcgamer.com/rss/",
    lang: "en",
    hosts: ["www.pcgamer.com"],
  },
  {
    id: "buffed",
    name: "buffed.de",
    site: "https://www.buffed.de/",
    feed: "https://www.buffed.de/feed.cfm",
    lang: "de",
    hosts: ["www.buffed.de"],
  },
  {
    id: "mein-mmo",
    name: "Mein-MMO",
    site: "https://mein-mmo.de/",
    feed: "https://mein-mmo.de/feed/",
    lang: "de",
    hosts: ["mein-mmo.de"],
  },
];

export const sourceById = (id: string) => NEWS_SOURCES.find((s) => s.id === id);

export interface FeedItem {
  title: string;
  url: string;
  /** Unix ms; null when the feed gave no usable date. */
  published: number | null;
  categories: string[];
}

export interface NewsItem {
  source: string;
  title: string;
  url: string;
  published: number;
}

export const MAX_TITLE = 240;

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", ndash: "–", mdash: "—",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", bdquo: "„", sbquo: "‚",
  auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß", eacute: "é", egrave: "è",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[e] ?? m;
  });
}

/** Plain one-line text: CDATA unwrapped, tags stripped, entities decoded, whitespace collapsed. */
export function plainText(raw: string): string {
  const unwrapped = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  // Decode twice: some feeds double-escape (&amp;#8217;), and tags may arrive escaped.
  const once = decodeEntities(unwrapped.replace(/<[^>]*>/g, ""));
  return decodeEntities(once.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

const tag = (block: string, name: string) => new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block)?.[1];

function atomLink(block: string): string | undefined {
  const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1]);
  const attr = (a: string, n: string) => new RegExp(`${n}\\s*=\\s*["']([^"']*)["']`, "i").exec(a)?.[1];
  const alt = links.find((a) => !attr(a, "rel") || attr(a, "rel") === "alternate");
  return alt ? attr(alt, "href") : undefined;
}

/** Parses RSS 2.0 and Atom. Tolerant by design: a malformed item is skipped, not fatal. */
export function parseFeed(xml: string): FeedItem[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  const items: FeedItem[] = [];
  for (const b of blocks) {
    const title = plainText(tag(b, "title") ?? "");
    const rssLink = tag(b, "link");
    const link = plainText(rssLink ?? atomLink(b) ?? "");
    const date = tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated") ?? tag(b, "dc:date");
    const ms = date ? Date.parse(plainText(date)) : NaN;
    const categories = [...b.matchAll(/<category\b([^>]*)>([\s\S]*?)<\/category>|<category\b([^>]*?)\/>/gi)]
      .map((m) => plainText(m[2] ?? /term\s*=\s*["']([^"']*)["']/i.exec(m[3] ?? "")?.[1] ?? ""))
      .filter(Boolean);
    if (title && link) items.push({ title, url: link, published: Number.isFinite(ms) ? ms : null, categories });
  }
  return items;
}

const FOREVER_TITLE = /\b(?:wow|world of warcraft)\s*[:\-–]?\s*forever\b/i;
const FOREVER_CATEGORY = /\bforever\b/i;

/** About WoW Forever: the headline names it, or the publisher filed the article under it. */
export const isAboutForever = (item: FeedItem) =>
  FOREVER_TITLE.test(item.title) || item.categories.some((c) => FOREVER_CATEGORY.test(c));

/** Drops tracking parameters and fragments so the same article isn't stored twice. */
export function canonicalUrl(raw: string, source: NewsSource): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol === "http:") u.protocol = "https:";
  if (u.protocol !== "https:" || !source.hosts.includes(u.hostname) || u.username || u.password) return null;
  for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|ref$)/i.test(key)) u.searchParams.delete(key);
  u.hash = "";
  return u.toString();
}

/** Feed items about WoW Forever, reduced to what we store and show. */
export function forSource(source: NewsSource, items: FeedItem[], now = Date.now()): NewsItem[] {
  const out: NewsItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!isAboutForever(item)) continue;
    const url = canonicalUrl(item.url, source);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      source: source.id,
      title: item.title.length > MAX_TITLE ? `${item.title.slice(0, MAX_TITLE - 1)}…` : item.title,
      url,
      // Undated or future-dated items get the fetch time.
      published: item.published && item.published <= now ? item.published : now,
    });
  }
  return out;
}

// ------------------------------------------------------------------ our own tags

/** Topic tags derived from the headline by our own keyword rules (en + de). */
export const NEWS_TOPICS: { id: string; label: string; match: RegExp }[] = [
  { id: "beta", label: "Beta", match: /\bbeta(?:server|test)?\b/i },
  { id: "classes", label: "Classes & talents", match: /\b(class(?:es)?|talents?|spec|klassen?|talente?|rassen?[- ]klassen)\b|race & class/i },
  { id: "dungeons", label: "Dungeons & raids", match: /\b(dungeons?|raids?|mega[- ]dungeon)\b|instanz|schlachtzug/i },
  { id: "pvp", label: "PvP", match: /\b(pvp|battlegrounds?|arena|schlachtfeld(?:er)?)\b/i },
  { id: "professions", label: "Professions", match: /\b(professions?|recipes?|crafting|enchants?|cooking|alchemy)\b|beruf|rezept|kochkunst|verzauber/i },
  { id: "bugs", label: "Bugs & hotfixes", match: /\b(bug(?:ged|s)?|hotfix(?:es)?|fix(?:ed)?|exploit|fehler)\b/i },
  { id: "economy", label: "Economy", match: /\b(gold|auction house|ah|rmt|real money|economy|auktionshaus|goldkauf)\b/i },
];

export const newsTopics = (title: string) => NEWS_TOPICS.filter((t) => t.match.test(title)).map((t) => t.id);
