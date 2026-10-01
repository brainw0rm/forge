// Reads the publishers' public news feeds, keeps the headlines about WoW Forever and sends them
// to the site. Runs every 2 hours in GitHub Actions (.github/workflows/refresh-news.yml); locally:
//   npm run news            -> posts to the local dev server (http://localhost:8788)
//   npm run news -- --dry   -> only prints what it found
// Env: SITE_URL (default http://localhost:8788), NOTIFY_SECRET (default: read from .dev.vars).
//
// Being a polite client: one request per feed per run, an identifying User-Agent with a
// contact URL, a timeout, and nothing but the feed itself is fetched (never the articles).

import { readFileSync } from "node:fs";
import { NEWS_SOURCES, forSource, parseFeed, type NewsItem } from "../shared/news.ts";

const UA = "ForeverForgeNews/1.0 (+https://forever-forge.com/news)";
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 8 * 1024 * 1024;

const dry = process.argv.includes("--dry");
const site = (process.env.SITE_URL || "http://localhost:8788").replace(/\/$/, "");
const secret = process.env.NOTIFY_SECRET || devSecret();

function devSecret(): string | undefined {
  try {
    return /^NOTIFY_SECRET\s*=\s*"?([^"\n]+)"?/m.exec(readFileSync(new URL("../.dev.vars", import.meta.url), "utf8"))?.[1];
  } catch {
    return undefined;
  }
}

async function fetchFeed(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error(`feed larger than ${MAX_BYTES} bytes`);
  return text;
}

const found: NewsItem[] = [];
let failures = 0;
for (const source of NEWS_SOURCES) {
  try {
    const items = forSource(source, parseFeed(await fetchFeed(source.feed)));
    found.push(...items);
    console.log(`${source.name.padEnd(22)} ${String(items.length).padStart(3)} about WoW Forever`);
  } catch (err) {
    failures++;
    console.warn(`${source.name.padEnd(22)} skipped: ${(err as Error).message}`);
  }
}

if (dry) {
  for (const i of found.sort((a, b) => b.published - a.published)) console.log(`${new Date(i.published).toISOString().slice(0, 16)}  ${i.source.padEnd(14)} ${i.title}`);
} else {
  if (!secret) throw new Error("Set NOTIFY_SECRET (or add it to .dev.vars for local development).");
  const res = await fetch(`${site}/api/internal/news`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, Origin: site, "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ items: found }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status} ${text}`);
  console.log(`Uploaded to ${site}: ${text}`);
}
// Only fail the job when every source failed; one publisher being down is normal.
if (failures === NEWS_SOURCES.length) process.exit(1);
