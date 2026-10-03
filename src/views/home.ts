import { KOFI_URL } from "../support";
import { adSlot, fillAds } from "../ads";
import { api, type NewsPage, type SavedBuild } from "../api";
import { buildLabel, classColor, getChangelog, getMeta, iconUrl, type Change, type Status } from "../data";
import { getItemDbMeta } from "../itemdb";
import { esc, setTitle } from "../ui";
import { buildCard } from "./builds";
import { heroHtml, wireHero } from "./hero";
import { headlineHtml } from "./news";

const BARS: Status[] = ["new", "reworked", "expanded", "tuned", "unchanged"];

const KIND: Record<string, string> = {
  text: "Tooltip changed",
  ranks: "Rank count changed",
  moved: "Moved",
  renamed: "Renamed",
  prereq: "Requirement changed",
  req: "Tier requirement changed",
};

function changeKind(c: Change): string {
  if (c.type === "added") return "Added";
  if (c.type === "removed") return "Removed";
  return KIND[c.kinds?.[0] ?? ""] ?? "Changed";
}

export async function renderHome(root: HTMLElement) {
  const [meta, log, top, news, itemMeta] = await Promise.all([
    getMeta(),
    getChangelog(),
    api.builds({ sort: "top" }).then((r) => r.builds, () => [] as SavedBuild[]),
    api.news({ limit: 6 }).catch((): NewsPage | null => null),
    getItemDbMeta().catch(() => null),
  ]);
  const itemCount = itemMeta?.classes.reduce((n, c) => n + c.count, 0) ?? 0;
  setTitle("");
  const totals: Record<string, number> = {};
  for (const c of meta.classes) for (const [k, v] of Object.entries(c.counts)) totals[k] = (totals[k] ?? 0) + v;
  const talents = Object.values(totals).reduce((a, b) => a + b, 0);
  const changed = (totals.new ?? 0) + (totals.reworked ?? 0) + (totals.expanded ?? 0) + (totals.tuned ?? 0);
  const lastChange = log.find((e) => e.changes.length);
  const names = new Map(meta.classes.map((c) => [c.slug, c.name]));


  root.innerHTML = `
    ${heroHtml(meta, { talents, changed, items: itemCount, builds: meta.builds.length })}

    ${
      lastChange
        ? `<section class="change-strip" aria-label="Latest talent changes">
            <header><h2>Latest talent changes</h2><span>${esc(buildLabel(meta, lastChange.build))} · ${lastChange.changes.length} changes</span>
              <a href="/changes" data-link>See all →</a></header>
            <ul>${lastChange.changes
              .slice(0, 5)
              .map(
                (ch) => `<li style="--class:${classColor(ch.class)}"><a href="/talents/${ch.class}?lens=changes" data-link>
                    <span class="hc-class">${esc(names.get(ch.class) ?? ch.class)}</span>
                    <span class="hc-name">${esc(ch.name)}</span>
                    <span class="hc-kind">${esc(changeKind(ch))}</span></a>
                  </li>`,
              )
              .join("")}</ul>
          </section>`
        : ""
    }

    ${adSlot("leaderboard")}

    ${
      top.length
        ? `<div class="section-head"><h2>Top community builds</h2><a href="/builds" data-link>See all →</a></div>
           <div class="build-grid">${top
             .slice(0, 3)
             .map((b) => buildCard(b, names.get(b.class) ?? b.class))
             .join("")}</div>`
        : ""
    }

    ${
      news?.items.length
        ? `<div class="section-head"><h2>Latest news</h2><a href="/news" data-link>All headlines →</a></div>
           <div class="news-grid">${news.items
             .map((h) => headlineHtml(h, news.sources.find((s) => s.id === h.source), names, { compact: true }))
             .join("")}</div>`
        : ""
    }

    <div class="section-head"><h2>Choose your class</h2>
      <span class="muted small">Data updated ${esc(new Date(meta.generated).toLocaleDateString(undefined, { month: "short", day: "numeric" }))}${
        lastChange ? ` · last talent change in build ${esc(lastChange.build)}` : ""
      }</span></div>
    <section class="class-grid" aria-label="Classes">
      ${meta.classes
        .map((c) => {
          const total = Object.values(c.counts).reduce((a, b) => a + b, 0);
          const bar = BARS.map((st) => {
            const n = st === "unchanged" ? c.counts.unchanged + c.counts.moved + c.counts.unverified : c.counts[st];
            return `<span class="bar-seg st-${st}" style="flex:${n}" title="${n} ${st}"></span>`;
          }).join("");
          return `<a class="class-card" href="/talents/${c.slug}" data-link style="--class:${classColor(c.slug)}">
              <div class="class-card-head">
                <h3>${esc(c.name)}</h3>
                <div class="class-icons">${c.trees.map((t) => `<img src="${iconUrl(t.icon)}" alt="" loading="lazy" />`).join("")}</div>
              </div>
              <p>${c.trees.map((t) => esc(t.name)).join(" · ")}</p>
              <div class="bar" aria-label="${c.counts.new} new, ${c.counts.reworked} reworked, ${c.counts.expanded} expanded, ${c.counts.tuned} tuned of ${total} talents">${bar}</div>
              <p class="counts"><b>${c.counts.new}</b> new · <b>${c.counts.reworked}</b> reworked · <b>${c.counts.expanded}</b> expanded · <b>${c.counts.tuned}</b> tuned</p>
            </a>`;
        })
        .join("")}
    </section>

    <div class="section-head"><h2>Tools</h2><span class="muted small">No account needed for any of these</span></div>
    <section class="tool-grid">
      <a class="tool-card" href="/items" data-link><b>Item database</b><span>All the items in the game, with stats and what's different from Classic.</span></a>
      <a class="tool-card" href="/compare" data-link><b>Compare builds</b><span>Put two builds side by side and see where they differ.</span></a>
      <a class="tool-card" href="/leveling" data-link><b>Leveling planner</b><span>What you get at each level: talent points, new spells, dungeons.</span></a>
      <a class="tool-card" href="/legacy" data-link><b>Legacy planner</b><span>Spend your account-wide Legacy points and see where to get more.</span></a>
      <a class="tool-card" href="/gear" data-link><b>Gear sandbox</b><span>Gear up with real items and tinker with the stat math yourself.</span></a>
      <a class="tool-card" href="/professions" data-link><b>Professions</b><span>All recipes with their reagents. The new ones are marked.</span></a>
      <a class="tool-card" href="/flights" data-link><b>Flight map</b><span>Every flight point and route, including the new ones in Riverglades and Mount Hyjal.</span></a>
      <a class="tool-card" href="/talents/warrior?lens=popularity" data-link><b>Popularity heatmap</b><span>Which talents people actually pick, level by level.</span></a>
    </section>

    ${
      KOFI_URL
        ? `<aside class="support-note">
            <p><b>Free, no paywall, no account needed.</b> Forever Forge is a one-person project. If it saves you some time, you can chip in for the server bill.</p>
            <a class="btn" href="${KOFI_URL}" target="_blank" rel="noopener">Support on Ko-fi</a>
          </aside>`
        : ""
    }
    <div class="parchment">
    <div class="section-head"><h2>What's different here</h2></div>
    <section class="features">
      <article>
        <span class="num">I</span>
        <h3>Changes lens</h3>
        <p>Flip it on and the new, reworked and retuned talents light up. Hover one to see which words changed since Classic.</p>
      </article>
      <article>
        <span class="num">II</span>
        <h3>Leveling order included</h3>
        <p>The calculator remembers the order you spend points in. Drag the slider to any level or move picks around, and it won't let you break tier rules.</p>
      </article>
      <article>
        <span class="num">III</span>
        <h3>Builds that keep up</h3>
        <p>A saved build knows which game build it was made on. If Blizzard changes one of its talents later, it tells you, beta or live.</p>
      </article>
      <article>
        <span class="num">IV</span>
        <h3>Emails when talents change</h3>
        <p>Watch a class or a build and we'll email you when a new game build touches its talents. Unsubscribing is one click.</p>
      </article>
    </section>
    </div>`;
  fillAds(root);
  wireHero(root, meta, top);
}
