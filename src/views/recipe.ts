// One recipe: what it makes, the reagents (and which of them are crafted themselves, down to the
// raw materials), the skill-up colors, tools and station, how to get it (player reports and Classic Era
// sources), and what changed from Classic.

import { adSlot, fillAds } from "../ads";
import { craftingList, duration, itemIcon, makersOf, qColor, reagentChip, recipeUrl, skillBar } from "../crafting";
import { api } from "../api";
import { getAllProfessions, getClassicSources, getMeta, getProfession, greenAt, iconUrl, type ItemRef, type Profession, type Recipe } from "../data";
import { getItem, getItemDbMeta } from "../itemdb";
import { attachItemTips, itemTooltip } from "../itemtip";
import { openShare } from "../share";
import { classicBlock, openSourceReport, reportedHtml } from "../sources";
import { esc, setTitle, toast } from "../ui";

/** Raw materials for `times` crafts of `r`: crafted reagents are replaced by their own reagents. */
export function rawMaterials(r: Recipe, times: number, makers: ReturnType<typeof makersOf>, seen = new Set<number>()) {
  const out = new Map<number, ItemRef>();
  const add = (i: ItemRef, n: number) => {
    const have = out.get(i.id);
    if (have) have.count += n;
    else out.set(i.id, { ...i, count: n });
  };
  for (const i of r.reagents) {
    const maker = makers.get(i.id);
    const need = i.count * times;
    if (maker && !seen.has(i.id) && maker.recipe.spell !== r.spell) {
      const per = maker.recipe.creates?.count ?? 1;
      const crafts = Math.ceil(need / per);
      for (const sub of rawMaterials(maker.recipe, crafts, makers, new Set([...seen, i.id])).values()) add(sub, sub.count);
    } else add(i, need);
  }
  return out;
}

export async function renderRecipe(root: HTMLElement, slug: string, spell: number) {
  const prof = await getProfession(slug).catch(() => null);
  const r = prof?.recipes.find((x) => x.spell === spell);
  if (!prof || !r) {
    setTitle("Recipe not found");
    root.innerHTML = `<section class="page"><div class="empty"><h1>Recipe not found</h1>
      <p>There's no such recipe in the game client.</p><a class="btn" href="/professions" data-link>All professions</a></div></section>`;
    return;
  }
  const out = r.creates;
  const [meta, result, dbMeta] = await Promise.all([getMeta(), out ? getItem(out.id) : Promise.resolve(null), getItemDbMeta()]);
  setTitle(`${r.name} (${prof.name} recipe)`, `${prof.name} recipe ${r.name} in WoW Forever: reagents, skill-up colors, ${r.station ? `${r.station}, ` : ""}and how to learn it.`);
  const cat = prof.categories.find((c) => c.id === r.cat);
  const typeName = (() => {
    if (!result) return "";
    const cls = dbMeta.classes.find((c) => c.id === result.cls);
    return cls?.subs.find((s) => s.id === result.sub)?.name ?? cls?.name ?? "";
  })();
  const classNames = new Map(meta.classes.map((c) => [c.slug, c.name]));

  const learned = r.learnedFrom
    ? `<ul class="learn-list">${r.learnedFrom
        .map((i) => `<li><a href="/items/${i.id}" data-link data-tip-item="${i.id}">${itemIcon(i)}<span style="--q:${qColor(i.q)}">${esc(i.name)}</span></a>${
          i.skill ? `<small>requires ${esc(prof.name)} (${i.skill})</small>` : ""
        }</li>`)
        .join("")}</ul>`
    : r.auto
      ? `<p>Learned automatically when you pick up ${esc(prof.name)}.</p>`
      : `<p>No recipe item in the game files teaches this one.</p>`;

  const classic = r.classic
    ? `<section class="codex"><h2>Changed from Classic Era</h2><dl class="was">
        ${r.classic.reagents ? `<div><dt>Classic reagents</dt><dd>${r.classic.reagents.map((i) => reagentChip(i)).join("") || "none"}</dd></div>` : ""}
        ${r.classic.yellow !== undefined ? `<div><dt>Yellow from</dt><dd>${r.classic.yellow} → <b>${r.yellow}</b></dd></div>` : ""}
        ${r.classic.grey !== undefined ? `<div><dt>Grey from</dt><dd>${r.classic.grey} → <b>${r.grey}</b></dd></div>` : ""}
      </dl></section>`
    : r.new
      ? `<section class="codex"><h2>New in Forever</h2><p>Classic Era ${esc(meta.classicBuild)} doesn't have this recipe.</p></section>`
      : "";

  root.innerHTML = `
    <section class="page recipe-page">
      <nav class="crumbs"><a href="/professions" data-link>Professions</a> / <a href="/professions/${slug}" data-link>${esc(prof.name)}</a>${
        cat ? ` / <a href="/professions/${slug}?cat=${cat.id}" data-link>${esc(cat.name)}</a>` : ""
      }</nav>
      <header class="recipe-hero">
        ${out ? itemIcon(out, "hero-icon") : `<img class="ico hero-icon" src="${iconUrl(prof.icon)}" alt="" />`}
        <div>
          <p class="eyebrow">${esc(prof.name)} recipe${r.new ? ` · <span class="tag tag-new">New in Forever</span>` : ""}${r.classic ? ` · <span class="tag tag-changed">Changed</span>` : ""}</p>
          <h1 ${out ? `style="--q:${qColor(out.q)}"` : ""}>${esc(r.name)}</h1>
          ${out && out.count > 1 ? `<p class="muted">Makes ${out.count} at a time</p>` : ""}
        </div>
      </header>
      <div class="recipe-layout">
        <div class="recipe-main">
          <section class="codex">
            <h2>Reagents</h2>
            <div class="qty-row">
              <label for="qty">Crafts</label>
              <div class="stepper"><button type="button" data-step="-1" aria-label="One fewer">−</button><input id="qty" type="number" inputmode="numeric" min="1" max="999" value="1" /><button type="button" data-step="1" aria-label="One more">+</button></div>
              <button class="btn primary" id="add">Add to crafting list</button>
            </div>
            <div class="reagent-list" id="reagents"></div>
            <div id="raw"></div>
          </section>
          <section class="codex">
            <h2>Skill</h2>
            ${skillBar(r)}
            <p class="small">${r.learn ? `Learned at <b>${r.learn}</b>` : "The skill to learn it is set by the trainer and isn't in the game files"}${
              r.yellow && r.grey > (r.learn ?? 0)
                ? `. Always a skill-up (orange) until ${r.yellow}, usually (yellow) until ${greenAt(r)}, sometimes (green) until ${r.grey}, then grey.`
                : "."
            }${r.skillups ? ` Each craft gives ${r.skillups} skill points.` : ""}</p>
          </section>
          <section class="codex">
            <h2>Requirements</h2>
            <dl class="facts">
              <div><dt>Profession</dt><dd><a href="/professions/${slug}" data-link>${esc(prof.name)}</a>${r.learn ? ` (${r.learn})` : ""}</dd></div>
              ${r.station ? `<div><dt>Crafting station</dt><dd>${esc(r.station)}</dd></div>` : ""}
              ${r.tools?.length ? `<div><dt>Tools</dt><dd>${esc(r.tools.join(", "))}</dd></div>` : ""}
              ${r.cooldown ? `<div><dt>Cooldown</dt><dd>${duration(r.cooldown)}</dd></div>` : ""}
              ${cat ? `<div><dt>Category</dt><dd>${esc(cat.name)}</dd></div>` : ""}
            </dl>
          </section>
          <section class="codex">
            <h2>How to get it</h2>
            ${learned}
            <h3 class="src-head">In WoW Forever <small>reported by players</small></h3>
            <div id="reported"><p class="muted small">Loading…</p></div>
            <button type="button" class="btn small src-report" id="report-source">Where did you find it?</button>
            <div id="classic-sources"></div>
          </section>
          ${classic}
        </div>
        <aside class="recipe-side">
          <section class="codex result">
            <h2>${out ? "Creates" : "Effect"}</h2>
            ${result ? itemTooltip(result, typeName, classNames, { floating: true }) : r.desc ? `<p>${esc(r.desc)}</p>` : `<p class="muted">Not in the client data.</p>`}
            ${out ? `<p><a href="/items/${out.id}" data-link>Item page</a></p>` : ""}
          </section>
          <div class="side-actions"><button class="btn" id="share">Share</button></div>
          ${adSlot("rectangle")}
        </aside>
      </div>
    </section>`;

  attachItemTips(root);
  const qtyInput = root.querySelector<HTMLInputElement>("#qty")!;
  const qty = () => Math.max(1, Math.min(999, Math.round(Number(qtyInput.value) || 1)));
  let profs: Profession[] | null = null;
  const drawReagents = async () => {
    const n = qty();
    root.querySelector("#reagents")!.innerHTML = r.reagents.length ? r.reagents.map((i) => reagentChip(i, n)).join("") : `<p class="muted">No reagents.</p>`;
    // Crafted reagents: link their recipes and add up the raw materials underneath.
    profs ??= await getAllProfessions();
    const makers = makersOf(profs);
    const crafted = r.reagents.filter((i) => makers.has(i.id) && makers.get(i.id)!.recipe.spell !== r.spell);
    if (!crafted.length) return;
    const raw = rawMaterials(r, n, makers);
    root.querySelector("#raw")!.innerHTML = `
      <p class="crafted-note">${crafted
        .map((i) => {
          const m = makers.get(i.id)!;
          return `<a href="${recipeUrl(m.slug, m.recipe.spell)}" data-link>${esc(i.name)}</a>`;
        })
        .join(", ")} ${crafted.length === 1 ? "is" : "are"} crafted too.</p>
      <details class="raw"><summary>All raw materials for ${n} craft${n === 1 ? "" : "s"}</summary>
        <div class="reagent-list">${[...raw.values()].map((i) => reagentChip(i)).join("")}</div></details>`;
  };
  qtyInput.addEventListener("input", drawReagents);
  root.querySelectorAll<HTMLButtonElement>("[data-step]").forEach((b) =>
    b.addEventListener("click", () => {
      qtyInput.value = String(Math.max(1, qty() + Number(b.dataset.step)));
      drawReagents();
    }),
  );
  root.querySelector("#add")!.addEventListener("click", () => {
    craftingList.add(slug, r.spell, qty());
    toast(`${qty()}× ${r.name} added to your crafting list`);
  });
  root.querySelector("#share")!.addEventListener("click", () =>
    openShare({ url: `${location.origin}${recipeUrl(slug, r.spell)}`, text: `${r.name}: ${prof.name} recipe in WoW Forever` }),
  );
  drawReagents();
  fillAds(root);

  // Where it comes from: approved player reports (live), then Classic Era's sources.
  const drawReported = () =>
    api
      .sources(slug, r.spell)
      .then(({ sources }) => (root.querySelector("#reported")!.innerHTML = reportedHtml(sources)))
      .catch(() => (root.querySelector("#reported")!.innerHTML = `<p class="muted small">Player reports couldn't be loaded.</p>`));
  drawReported();
  root.querySelector("#report-source")!.addEventListener("click", () => openSourceReport(slug, r.spell, r.name, drawReported));
  getClassicSources()
    .then((file) => (root.querySelector("#classic-sources")!.innerHTML = classicBlock(file, r.spell, r.learnedFrom ?? [])))
    .catch(() => undefined);
}
