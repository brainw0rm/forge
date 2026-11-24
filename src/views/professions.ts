// Profession pages: the overview of every profession, and one profession's compendium: what it is,
// its ranks and specializations, and every recipe with filters and the skill-up colors at your skill.

import { adSlot, fillAds, withListAds } from "../ads";
import { recipeCard, wireAddButtons } from "../crafting";
import { difficulty, getMeta, getProfession, getProfessions, iconUrl, KIND_LABEL, type Profession, type ProfessionSummary, type Recipe } from "../data";
import { attachItemTips } from "../itemtip";
import { esc, setTitle, toast } from "../ui";

export function professionGrid(list: ProfessionSummary[]) {
  const card = (p: ProfessionSummary) => `<a class="prof-tile" href="/professions/${p.slug}" data-link>
      <img src="${iconUrl(p.icon)}" alt="" loading="lazy" />
      <span class="pt-name">${esc(p.name)}</span>
      <span class="pt-meta">${p.recipes} recipe${p.recipes === 1 ? "" : "s"}${p.new ? ` · <b>${p.new} new</b>` : ""}</span>
    </a>`;
  return (["primary", "gathering", "secondary"] as const)
    .map((kind) => {
      const group = list.filter((p) => p.kind === kind);
      return group.length ? `<h2 class="section-title">${KIND_LABEL[kind]}</h2><div class="prof-tiles">${group.map(card).join("")}</div>` : "";
    })
    .join("");
}

export async function renderProfessionList(root: HTMLElement) {
  const list = await getProfessions();
  setTitle("WoW Forever Professions", "Every World of Warcraft: Forever profession with all its recipes, ranks and specializations.");
  root.innerHTML = `
    <section class="page">
      <header class="page-head"><div>
        <h1>Professions</h1>
        <p class="lede">Every profession in the game files, with all its recipes, ranks and specializations.</p>
      </div></header>
      ${professionGrid(list)}
      ${adSlot("leaderboard")}
    </section>`;
  fillAds(root);
}

// ------------------------------------------------------------------ one profession

const PAGE = 60;
const skillKey = (slug: string) => `ff-skill-${slug}`;
function readSkill(slug: string): number | null {
  try {
    const v = localStorage.getItem(skillKey(slug));
    return v === null || v === "" ? null : Math.max(0, Math.min(450, Number(v) || 0));
  } catch {
    return null;
  }
}
function writeSkill(slug: string, v: number | null) {
  try {
    if (v === null) localStorage.removeItem(skillKey(slug));
    else localStorage.setItem(skillKey(slug), String(v));
  } catch {
    /* not kept in private mode */
  }
}

interface Filters {
  q: string;
  cat: string;
  show: "" | "new" | "changed" | "skillup";
  source: "" | "item" | "other";
}

function matches(r: Recipe, f: Filters, skill: number | null) {
  if (f.cat && String(r.cat ?? "") !== f.cat) return false;
  if (f.show === "new" && !r.new) return false;
  if (f.show === "changed" && !r.classic) return false;
  if (f.show === "skillup" && (skill === null || !["orange", "yellow", "green"].includes(difficulty(r, skill)))) return false;
  if (f.source === "item" && !r.learnedFrom) return false;
  if (f.source === "other" && r.learnedFrom) return false;
  const q = f.q.trim().toLowerCase();
  return (
    !q ||
    r.name.toLowerCase().includes(q) ||
    !!r.creates?.name.toLowerCase().includes(q) ||
    r.reagents.some((x) => x.name.toLowerCase().includes(q)) ||
    !!r.learnedFrom?.some((x) => x.name.toLowerCase().includes(q))
  );
}

function about(p: Profession) {
  const stations = new Map<string, number>();
  const tools = new Map<string, number>();
  for (const r of p.recipes) {
    if (r.station) stations.set(r.station, (stations.get(r.station) ?? 0) + 1);
    for (const t of r.tools ?? []) tools.set(t, (tools.get(t) ?? 0) + 1);
  }
  const counted = (m: Map<string, number>) =>
    [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `<li><b>${esc(k)}</b><span>${n} recipe${n === 1 ? "" : "s"}</span></li>`).join("");
  const cooldowns = p.recipes.filter((r) => r.cooldown);
  return `
    ${p.ranks.length ? `<section class="codex"><h2>Ranks</h2><ol class="ranks">${p.ranks
      .map((r) => `<li><b>${esc(r.name)}</b><p>${esc(r.desc)}</p></li>`)
      .join("")}</ol></section>` : ""}
    ${p.specs.length ? `<section class="codex"><h2>Specializations</h2><ul class="specs">${p.specs
      .map((s) => `<li><b>${esc(s.name)}</b><p>${esc(s.desc)}</p></li>`)
      .join("")}</ul></section>` : ""}
    ${stations.size ? `<section class="codex"><h2>Crafting stations</h2><p class="muted small">Recipes that need you to stand near one.</p><ul class="tally">${counted(stations)}</ul></section>` : ""}
    ${tools.size ? `<section class="codex"><h2>Tools</h2><p class="muted small">Carried in your bags while crafting.</p><ul class="tally">${counted(tools)}</ul></section>` : ""}
    ${cooldowns.length ? `<section class="codex"><h2>Cooldowns</h2><ul class="tally">${cooldowns
      .map((r) => `<li><a href="/professions/${p.slug}/${r.spell}" data-link>${esc(r.name)}</a><span>${Math.round((r.cooldown ?? 0) / 3600) || "<1"} h</span></li>`)
      .join("")}</ul></section>` : ""}
    ${p.materials ? `<section class="codex"><h2>Materials (${esc(p.materials.type)})</h2>
        <p class="muted small">Items the game files class as ${esc(p.materials.type.toLowerCase())}. Where they're gathered and at what skill isn't in the client data.</p>
        <div class="mat-grid">${p.materials.items
          .map((i) => `<a class="reagent" href="/items/${i.id}" data-link data-tip-item="${i.id}"><img class="ico" src="${iconUrl(i.icon)}" alt="" loading="lazy" /><span>${esc(i.name)}</span></a>`)
          .join("")}</div></section>` : ""}`;
}

export async function renderProfession(root: HTMLElement, slug: string, params: URLSearchParams) {
  const list = await getProfessions();
  const summary = list.find((p) => p.slug === slug);
  if (!summary) {
    setTitle("Profession not found");
    root.innerHTML = `<section class="page"><div class="empty"><h1>Profession not found</h1><a class="btn" href="/professions" data-link>All professions</a></div></section>`;
    return;
  }
  const [prof, meta] = await Promise.all([getProfession(slug), getMeta()]);
  setTitle(`${prof.name} Recipes & Guide for WoW Forever`, `All ${prof.recipes.length} ${prof.name} recipes in World of Warcraft: Forever, with reagents, skill levels, tools and recipe items.`);
  const f: Filters = {
    q: params.get("q") ?? "",
    cat: params.get("cat") ?? "",
    show: (["new", "changed", "skillup"].includes(params.get("show") ?? "") ? params.get("show") : "") as Filters["show"],
    source: (["item", "other"].includes(params.get("source") ?? "") ? params.get("source") : "") as Filters["source"],
  };
  let skill = params.has("skill") ? Math.max(0, Number(params.get("skill")) || 0) : readSkill(slug);
  const tab = params.get("tab") === "about" || !prof.recipes.length ? "about" : "recipes";

  root.innerHTML = `
    <section class="page prof-page">
      <nav class="crumbs"><a href="/professions" data-link>Professions</a> / ${esc(prof.name)}</nav>
      <header class="prof-hero">
        <img class="prof-emblem" src="${iconUrl(prof.icon)}" alt="" />
        <div>
          <p class="eyebrow">${KIND_LABEL[prof.kind]} profession</p>
          <h1>${esc(prof.name)}</h1>
          <p class="lede">${esc(prof.desc)}</p>
          <p class="prof-stats"><span><b>${prof.recipes.length}</b> recipes</span>${summary.new ? `<span><b>${summary.new}</b> new in Forever</span>` : ""}${
            summary.changed ? `<span><b>${summary.changed}</b> changed from Classic</span>` : ""
          }</p>
        </div>
      </header>
      <nav class="seg-tabs" role="tablist">
        ${prof.recipes.length ? `<a href="/professions/${slug}" data-link role="tab" aria-selected="${tab === "recipes"}">Recipes</a>` : ""}
        <a href="/professions/${slug}?tab=about" data-link role="tab" aria-selected="${tab === "about"}">About ${esc(prof.name)}</a>
      </nav>
      <div id="prof-body"></div>
      <p class="data-note">From the ${meta.phase === "live" ? "game client" : "beta client"}, build ${esc(meta.build)}, compared with Classic Era ${esc(meta.classicBuild)}.
        Where recipe items drop or who sells them isn't in the client data.
        <button type="button" class="link-btn" data-report-bug data-kind="data">Something look wrong?</button></p>
    </section>`;
  const body = root.querySelector<HTMLElement>("#prof-body")!;
  attachItemTips(root);
  wireAddButtons(root, (name) => toast(`${name} added to your crafting list`));

  if (tab === "about") {
    body.innerHTML = about(prof) || `<p class="muted">Nothing more about ${esc(prof.name)} in the game files.</p>`;
    return;
  }

  body.innerHTML = `
    <div class="skill-box">
      <label for="skill">Your ${esc(prof.name)} skill</label>
      <input id="skill" type="number" inputmode="numeric" min="0" max="450" placeholder="e.g. 150" value="${skill ?? ""}" />
      <p class="legend"><span class="sk-o">orange</span> always a skill-up · <span class="sk-y">yellow</span> usually · <span class="sk-g">green</span> sometimes · <span class="sk-x">grey</span> never</p>
    </div>
    <div class="filters">
      <input type="search" id="q" value="${esc(f.q)}" placeholder="Search recipes, results, reagents" aria-label="Search recipes" />
      <div class="filter-row">
        ${prof.categories.length ? `<select id="cat" aria-label="Category"><option value="">All categories</option>${prof.categories
          .map((c) => `<option value="${c.id}" ${String(c.id) === f.cat ? "selected" : ""}>${esc(c.name)}</option>`)
          .join("")}</select>` : ""}
        <select id="show" aria-label="Show">
          <option value="">All recipes</option>
          <option value="skillup" ${f.show === "skillup" ? "selected" : ""}>Skill-ups at my skill</option>
          <option value="new" ${f.show === "new" ? "selected" : ""}>New in Forever</option>
          <option value="changed" ${f.show === "changed" ? "selected" : ""}>Changed from Classic</option>
        </select>
        <select id="source" aria-label="Learned from">
          <option value="">Any source</option>
          <option value="item" ${f.source === "item" ? "selected" : ""}>From a recipe item</option>
          <option value="other" ${f.source === "other" ? "selected" : ""}>No recipe item</option>
        </select>
      </div>
    </div>
    <p class="result-count" id="count" aria-live="polite"></p>
    <div class="recipe-grid" id="recipes"></div>
    <div class="more-row"><button class="btn" id="more" hidden>Show more</button></div>
    ${adSlot("leaderboard")}`;

  let shown = PAGE;
  let firstDraw = true;
  const draw = () => {
    const rows = prof.recipes.filter((r) => matches(r, f, skill));
    const visible = rows.slice(0, shown);
    // In-list ads only on the first render; redrawing on every keystroke would re-request them.
    body.querySelector("#recipes")!.innerHTML = rows.length
      ? firstDraw
        ? withListAds(visible, (r) => recipeCard(slug, r, skill), 24)
        : visible.map((r) => recipeCard(slug, r, skill)).join("")
      : `<div class="empty"><h3>No recipes match</h3><p>Try another search or filter.</p></div>`;
    body.querySelector("#count")!.textContent = `${rows.length} of ${prof.recipes.length} recipes`;
    body.querySelector<HTMLButtonElement>("#more")!.hidden = rows.length <= shown;
    const qs = new URLSearchParams();
    if (f.q) qs.set("q", f.q);
    if (f.cat) qs.set("cat", f.cat);
    if (f.show) qs.set("show", f.show);
    if (f.source) qs.set("source", f.source);
    history.replaceState(null, "", `/professions/${slug}${qs.size ? `?${qs}` : ""}`);
    if (firstDraw) fillAds(root);
    firstDraw = false;
  };
  const refilter = () => {
    shown = PAGE;
    draw();
  };
  body.querySelector<HTMLInputElement>("#q")!.addEventListener("input", (e) => {
    f.q = (e.target as HTMLInputElement).value;
    refilter();
  });
  for (const id of ["cat", "show", "source"] as const) {
    body.querySelector<HTMLSelectElement>(`#${id}`)?.addEventListener("change", (e) => {
      (f as unknown as Record<string, string>)[id] = (e.target as HTMLSelectElement).value;
      refilter();
    });
  }
  body.querySelector<HTMLInputElement>("#skill")!.addEventListener("input", (e) => {
    const v = (e.target as HTMLInputElement).value;
    skill = v === "" ? null : Math.max(0, Math.min(450, Number(v) || 0));
    writeSkill(slug, skill);
    draw();
  });
  body.querySelector("#more")!.addEventListener("click", () => {
    shown += PAGE;
    draw();
  });
  draw();
}
