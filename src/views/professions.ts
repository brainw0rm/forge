// Profession recipe browser, built from the game client's recipe data.

import { adSlot, fillAds, withListAds } from "../ads";
import { getProfession, getProfessions, iconUrl, QUALITY_COLOR, type ItemRef, type Recipe } from "../data";
import { esc, setTitle } from "../ui";

export async function renderProfessions(root: HTMLElement, slug: string, params: URLSearchParams) {
  const list = await getProfessions();
  if (!slug) {
    setTitle("WoW Forever Professions & Recipes", "Every World of Warcraft: Forever profession recipe, with the ones new in Forever marked.");
    const card = (p: (typeof list)[number]) => `<a class="prof-card" href="/professions/${p.slug}" data-link>
        <img src="${iconUrl(p.icon)}" alt="" loading="lazy" />
        <div><h3>${esc(p.name)}</h3><p class="muted small">${p.recipes} recipes${p.new ? ` · <span class="new-count">${p.new} new in Forever</span>` : ""}</p></div>
      </a>`;
    root.innerHTML = `
      <section class="page">
        <header class="page-head"><div>
          <h1>Professions</h1>
          <p class="lede">All recipes from the game client, with reagents and skill levels. Anything that wasn't in Classic Era is marked new.</p>
        </div></header>
        <h2 class="section-title">Primary</h2>
        <div class="prof-grid">${list.filter((p) => p.kind === "primary").map(card).join("")}</div>
        <h2 class="section-title">Secondary</h2>
        <div class="prof-grid">${list.filter((p) => p.kind === "secondary").map(card).join("")}</div>
        ${adSlot("leaderboard")}
      </section>`;
    fillAds(root);
    return;
  }

  const summary = list.find((p) => p.slug === slug);
  if (!summary) {
    setTitle("Profession not found");
    root.innerHTML = `<section class="page"><div class="empty"><h1>Profession not found</h1><a class="btn" href="/professions" data-link>All professions</a></div></section>`;
    return;
  }
  const prof = await getProfession(slug);
  setTitle(`${prof.name} Recipes in WoW Forever`, `All ${prof.recipes.length} ${prof.name} recipes in World of Warcraft: Forever.`);
  const state = { q: params.get("q") ?? "", onlyNew: params.get("new") === "1" };

  root.innerHTML = `
    <section class="page">
      <nav class="crumbs"><a href="/professions" data-link>Professions</a> / ${esc(prof.name)}</nav>
      <header class="page-head"><div>
        <h1><img class="title-icon" src="${iconUrl(summary.icon)}" alt="" />${esc(prof.name)}</h1>
        <p class="lede">${prof.recipes.length} recipes · ${summary.new} new in Forever. Sorted by the skill level where they turn yellow.</p>
      </div></header>
      <nav class="class-tabs prof-tabs">
        ${list.map((p) => `<a href="/professions/${p.slug}" data-link class="${p.slug === slug ? "active" : ""}" style="--c:var(--brass)">${esc(p.name)}</a>`).join("")}
      </nav>
      <div class="filter-row prof-filters">
        <input type="search" id="q" value="${esc(state.q)}" placeholder="Search recipes, results or reagents" aria-label="Search recipes" />
        <label class="check-pill"><input type="checkbox" id="new" ${state.onlyNew ? "checked" : ""} /> New in Forever only</label>
      </div>
      <div class="with-rail">
        <div class="recipe-list" id="recipes"></div>
        <aside class="rail">${adSlot("rail", "wide-only")}</aside>
      </div>
    </section>`;

  let firstDraw = true;
  const draw = () => {
    const needle = state.q.trim().toLowerCase();
    const rows = prof.recipes.filter(
      (r) =>
        (!state.onlyNew || r.new) &&
        (!needle ||
          r.name.toLowerCase().includes(needle) ||
          r.creates?.name.toLowerCase().includes(needle) ||
          r.reagents.some((x) => x.name.toLowerCase().includes(needle))),
    );
    // In-list ads only on the first render; redrawing on every keystroke would re-request ads.
    root.querySelector("#recipes")!.innerHTML = rows.length
      ? firstDraw
        ? withListAds(rows, recipeRow, 40)
        : rows.map(recipeRow).join("")
      : `<div class="empty"><h3>No recipes match</h3><p>Try a different search.</p></div>`;
    const qs = new URLSearchParams();
    if (state.q) qs.set("q", state.q);
    if (state.onlyNew) qs.set("new", "1");
    history.replaceState(null, "", `/professions/${slug}${qs.toString() ? `?${qs}` : ""}`);
    firstDraw = false;
  };
  root.querySelector<HTMLInputElement>("#q")!.addEventListener("input", (e) => {
    state.q = (e.target as HTMLInputElement).value;
    draw();
  });
  root.querySelector<HTMLInputElement>("#new")!.addEventListener("change", (e) => {
    state.onlyNew = (e.target as HTMLInputElement).checked;
    draw();
  });
  draw();
  fillAds(root);
}

const itemChip = (i: ItemRef, withCount: boolean) =>
  `<a class="item-chip" href="/items/${i.id}" data-link title="${esc(i.name)}"><img src="${iconUrl(i.icon)}" alt="" loading="lazy" />${
    withCount && i.count > 1 ? `<b class="count">${i.count}</b>` : ""
  }<span style="color:${QUALITY_COLOR[i.q] ?? QUALITY_COLOR[1]}">${esc(i.name)}</span></a>`;

function recipeRow(r: Recipe) {
  const out = r.creates;
  return `<div class="recipe">
      <div class="recipe-main">
        ${out ? `<img class="recipe-icon" src="${iconUrl(out.icon)}" alt="" loading="lazy" />` : `<span class="recipe-icon blank"></span>`}
        <div>
          ${out ? `<a class="recipe-name" href="/items/${out.id}" data-link style="color:${QUALITY_COLOR[out.q] ?? QUALITY_COLOR[1]}">${esc(r.name)}</a>` : `<b>${esc(r.name)}</b>`}
          ${out && out.count > 1 ? `<small class="muted"> ×${out.count}</small>` : ""}
          ${r.new ? `<span class="tag tag-new">New</span>` : ""}
          <div class="skill-bar" title="Orange until ${r.yellow}, yellow until ${r.grey - Math.round((r.grey - r.yellow) / 2)}, green, grey at ${r.grey}">
            ${r.yellow ? `<span class="sk-y">${r.yellow}</span><span class="sk-g">${Math.round((r.yellow + r.grey) / 2)}</span><span class="sk-x">${r.grey}</span>` : `<span class="muted small">No skill-up range</span>`}
          </div>
        </div>
      </div>
      <div class="reagents">${r.reagents.map((i) => itemChip(i, true)).join("")}</div>
    </div>`;
}
