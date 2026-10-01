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

    <div class="section-head"><h2>Tools</h2><span class="muted small">Everything works without an account</span></div>
    <section class="tool-grid">
      <a class="tool-card" href="/items" data-link><b>Item database</b><span>Every item in the game with stats, effects and what changed since Classic.</span></a>
      <a class="tool-card" href="/compare" data-link><b>Compare builds</b><span>Overlay two builds and see every talent that differs, rank by rank.</span></a>
      <a class="tool-card" href="/leveling" data-link><b>Leveling planner</b><span>Talent points, trainer abilities and dungeons for every level from 1 to 60.</span></a>
      <a class="tool-card" href="/legacy" data-link><b>Legacy planner</b><span>Spend the account-wide Legacy points and see how to earn more.</span></a>
      <a class="tool-card" href="/gear" data-link><b>Gear sandbox</b><span>Equip real items from the game and run an editable stat formula sheet.</span></a>
      <a class="tool-card" href="/professions" data-link><b>Professions</b><span>Every recipe with reagents, and which ones are new in Forever.</span></a>
      <a class="tool-card" href="/talents/warrior?lens=popularity" data-link><b>Popularity heatmap</b><span>See which talents the community actually takes, by level.</span></a>
    </section>

    <div class="parchment">
    <div class="section-head"><h2>Why Forever Forge</h2></div>
    <section class="features">
      <article>
        <span class="num">I</span>
        <h3>Changes lens</h3>
        <p>One switch highlights every talent that is new, reworked or retuned, with a word-level diff against Classic Era in each tooltip.</p>
      </article>
      <article>
        <span class="num">II</span>
        <h3>Leveling path built in</h3>
        <p>Points are stored in the order you spend them. Scrub to any level and reorder picks without breaking tier requirements.</p>
      </article>
      <article>
        <span class="num">III</span>
        <h3>Builds that stay current</h3>
        <p>Saved builds remember the game build they were made on and flag any talent that has changed since, through the beta and into the live game.</p>
      </article>
      <article>
        <span class="num">IV</span>
        <h3>Alerts when talents change</h3>
        <p>Watch a class or a saved build and get an email when a new game build changes its talents.</p>
      </article>
    </section>
    </div>`;
  fillAds(root);
  wireHero(root, meta, top);
}
