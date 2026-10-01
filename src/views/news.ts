// News: headlines about WoW Forever from the big WoW sites, each linking to the original article.
// We show only headline, publisher and time; the topic tags and class links are our own.
// No ads on this page: the headlines are other people's work, so we don't monetize next to them.

import { api, type Headline, type NewsPage, type NewsSourceInfo } from "../api";
import { classColor, getMeta } from "../data";
import { currentUser } from "../session";
import { NEWS_TOPICS, newsTopics } from "../../shared/news";
import { esc, setTitle, toast } from "../ui";

/** Class names as they appear in English and German headlines. */
const CLASS_WORDS: [RegExp, string][] = [
  [/\b(warriors?|krieger)\b/i, "warrior"],
  [/\bpaladins?\b/i, "paladin"],
  [/\b(hunters?|jäger)\b/i, "hunter"],
  [/\b(rogues?|schurken?)\b/i, "rogue"],
  [/\b(priests?|priester)\b/i, "priest"],
  [/\b(shamans?|schamanen?)\b/i, "shaman"],
  [/\b(mages?|magier)\b/i, "mage"],
  [/\b(warlocks?|hexenmeister)\b/i, "warlock"],
  [/\b(druids?|druiden?)\b/i, "druid"],
];

const topicLabel = new Map(NEWS_TOPICS.map((t) => [t.id, t.label]));

function dayLabel(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(today) - start(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

export function timeAgo(ms: number): string {
  const min = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (min < 60) return `${Math.max(min, 1)} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** One headline: the publisher's title linking out, plus our own tags. */
export function headlineHtml(h: Headline, source: NewsSourceInfo | undefined, names: Map<string, string>, opts: { admin?: boolean; compact?: boolean } = {}) {
  const classes = CLASS_WORDS.filter(([re]) => re.test(h.title)).map(([, slug]) => slug);
  const tags = newsTopics(h.title).map((t) => `<span class="news-tag">${esc(topicLabel.get(t) ?? t)}</span>`);
  const classLinks = classes.map(
    (slug) => `<a class="news-class" href="/talents/${slug}" data-link style="--class:${classColor(slug)}">${esc(names.get(slug) ?? slug)} talents</a>`,
  );
  const lang = source?.lang ?? "en";
  const time = new Date(h.published).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `<article class="news-item${opts.compact ? " compact" : ""}">
      ${opts.compact ? "" : `<time datetime="${new Date(h.published).toISOString()}">${esc(time)}</time>`}
      <div class="news-body">
        <a class="news-title" href="${esc(h.url)}" target="_blank" rel="noopener" lang="${lang}">${esc(h.title)}<span class="ext" aria-label="(opens ${esc(source?.name ?? "the publisher")})"> ↗</span></a>
        <div class="news-meta">
          <span class="news-source">${esc(source?.name ?? h.source)}</span>
          ${lang !== "en" ? `<span class="news-lang">${lang.toUpperCase()}</span>` : ""}
          ${opts.compact ? `<span>${esc(timeAgo(h.published))}</span>` : [...tags, ...classLinks].join("")}
        </div>
      </div>
      ${opts.admin ? `<button class="btn small ghost danger" data-hide="${esc(h.url)}">Hide</button>` : ""}
    </article>`;
}

export async function renderNews(root: HTMLElement, params: URLSearchParams) {
  const lang = ["en", "de"].includes(params.get("lang") ?? "") ? params.get("lang")! : "";
  const source = params.get("source") ?? "";
  setTitle("WoW Forever news", "Headlines about World of Warcraft: Forever from Wowhead, MMO-Champion, Blizzard Watch and more, linking to the original articles.");
  const [meta, user, first] = await Promise.all([getMeta(), currentUser(), api.news({ lang, source })]);
  const names = new Map(meta.classes.map((c) => [c.slug, c.name]));
  const admin = user?.role === "admin";
  const sources = new Map(first.sources.map((s) => [s.id, s]));
  const href = (next: { lang?: string; source?: string }) => {
    const q = new URLSearchParams();
    const l = next.lang ?? lang;
    const s = next.source ?? source;
    if (l) q.set("lang", l);
    if (s) q.set("source", s);
    return `/news${q.size ? `?${q}` : ""}`;
  };
  const shownSources = first.sources.filter((s) => !lang || s.lang === lang);

  root.innerHTML = `
    <section class="page news-page">
      <header class="page-head">
        <div>
          <h1>News</h1>
          <p class="lede">Headlines about WoW Forever from the big WoW sites. Every headline links to the original article on the publisher's site.</p>
        </div>
        ${first.updatedAt ? `<p class="muted small">Checked every 2 hours · last update ${esc(timeAgo(first.updatedAt))}</p>` : ""}
      </header>
      <div class="with-rail">
        <div>
          <div class="filters">
            <nav class="seg" aria-label="Language">
              ${[["", "All languages"], ["en", "English"], ["de", "Deutsch"]]
                .map(([id, label]) => `<a href="${href({ lang: id, source: "" })}" data-link class="${lang === id ? "active" : ""}">${label}</a>`)
                .join("")}
            </nav>
            <nav class="seg" aria-label="Source">
              <a href="${href({ source: "" })}" data-link class="${source ? "" : "active"}">All sources</a>
              ${shownSources.map((s) => `<a href="${href({ source: s.id })}" data-link class="${source === s.id ? "active" : ""}">${esc(s.name)}</a>`).join("")}
            </nav>
          </div>
          <div class="news-list" id="news-list"></div>
          <div class="more" id="news-more"></div>
        </div>
        <aside class="rail">
          <section class="panel news-about">
            <h2>About these headlines</h2>
            <p>We read the public news feeds these publishers offer and keep only the headline, the publisher's name and the time. No article text, no images. To read an article, open it on the publisher's site.</p>
            <p>Topic tags and class links are added by Forever Forge.</p>
            <p class="small muted">Publisher and want your headlines removed? <a href="/imprint" data-link>Contact us</a> and we'll take them down.</p>
          </section>
          <section class="panel">
            <h2>Sources</h2>
            <ul class="source-list">
              ${first.sources
                .map((s) => `<li><a href="${esc(s.site)}" target="_blank" rel="noopener">${esc(s.name)}</a>${s.lang !== "en" ? ` <span class="news-lang">${s.lang.toUpperCase()}</span>` : ""}</li>`)
                .join("")}
            </ul>
          </section>
        </aside>
      </div>
    </section>`;

  const list = root.querySelector<HTMLElement>("#news-list")!;
  const more = root.querySelector<HTMLElement>("#news-more")!;
  let lastDay = "";
  let oldest = 0;
  const append = (page: NewsPage) => {
    let html = "";
    for (const h of page.items) {
      const day = dayLabel(h.published);
      if (day !== lastDay) {
        html += `<h2 class="news-day">${esc(day)}</h2>`;
        lastDay = day;
      }
      html += headlineHtml(h, sources.get(h.source), names, { admin });
      oldest = h.published;
    }
    list.insertAdjacentHTML("beforeend", html);
    more.innerHTML = page.hasMore ? `<button class="btn">Older headlines</button>` : "";
    more.querySelector("button")?.addEventListener("click", async (e) => {
      (e.currentTarget as HTMLButtonElement).disabled = true;
      append(await api.news({ lang, source, before: oldest }));
    });
  };
  append(first);
  if (!first.items.length) {
    list.innerHTML = `<div class="empty"><h3>No headlines yet</h3><p>New articles about WoW Forever show up here within a couple of hours.</p></div>`;
  }

  list.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-hide]");
    if (!btn) return;
    btn.disabled = true;
    try {
      await api.setNewsHidden(btn.dataset.hide!, true);
      btn.closest(".news-item")?.remove();
      toast("Headline hidden. Undo it on the moderation page.");
    } catch (err) {
      btn.disabled = false;
      toast((err as Error).message);
    }
  });
}
