// Profession pages: the overview of every profession, and one profession's compendium: what it is,
// its ranks and specializations, and every recipe with filters and the skill-up colors at your skill.

import { adSlot, fillAds } from "../ads";
import { recipeDetail, recipeRow, wireAddButtons } from "../crafting";
import { difficulty, getMeta, getProfession, getProfessions, iconUrl, KIND_LABEL, type Profession, type ProfessionSummary, type Recipe } from "../data";
import { attachItemTips } from "../itemtip";
import { esc, setTitle, toast } from "../ui";

export function professionGrid(list: ProfessionSummary[]) {
  const card = (p: ProfessionSummary) => `<a class="prof-tile" href="/professions/${p.slug}" data-link>
      <img src="${iconUrl(p.icon)}" alt="" loading="lazy" />
      <span class="pt-text"><span class="pt-name">${esc(p.name)}</span>
      <span class="pt-meta">${p.recipes} recipe${p.recipes === 1 ? "" : "s"}${p.new ? ` · <b>${p.new} new</b>` : ""}</span></span>
    </a>`;
  return (["primary", "gathering", "secondary"] as const)
    .map((kind) => {
      const group = list.filter((p) => p.kind === kind);
      // Columns follow the group's size (6 → 2×3 or 6 across, 4 → 2×2 or 4 across), so no tile sits alone on a row.
      return group.length
        ? `<h2 class="section-title">${KIND_LABEL[kind]}</h2><div class="prof-tiles" style="--n:${group.length};--n-mid:${group.length % 3 === 0 ? 3 : 2};--n-phone:${group.length === 3 ? 3 : 2}">${group.map(card).join("")}</div>`
        : "";
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

const PAGE = 200;
/** The highest skill a rank (Artisan) reaches; the skill bar is drawn against it. */
const SKILL_CAP = 300;
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
      <div class="wow-window">
        <img class="win-portrait" src="${iconUrl(prof.icon)}" alt="" />
        <header class="win-title">
          <h1>${esc(prof.name)}</h1>
          <a class="win-close" href="/professions" data-link aria-label="Close, back to all professions">✕</a>
        </header>
        <div class="win-sub">
          <div class="prof-title">
            <p class="eyebrow">${KIND_LABEL[prof.kind]} profession</p>
            <p class="lede">${esc(prof.desc)}</p>
            <p class="prof-stats"><span><b>${prof.recipes.length}</b> recipes</span>${summary.new ? `<span><b>${summary.new}</b> new in Forever</span>` : ""}${
              summary.changed ? `<span><b>${summary.changed}</b> changed from Classic</span>` : ""
            }</p>
          </div>
          <nav class="prof-views" aria-label="${esc(prof.name)}">
            ${prof.recipes.length ? `<a href="/professions/${slug}" data-link ${tab === "recipes" ? `aria-current="page"` : ""}>Recipes</a>` : ""}
            <a href="/professions/${slug}?tab=about" data-link ${tab === "about" ? `aria-current="page"` : ""}>Ranks &amp; info</a>
          </nav>
        </div>
        <div id="prof-body"></div>
      </div>
      <p class="data-note">From the ${meta.phase === "live" ? "game client" : "beta client"}, build ${esc(meta.build)}, compared with Classic Era ${esc(meta.classicBuild)}.
        Where recipe items drop or who sells them isn't in the client data.
        <button type="button" class="link-btn" data-report-bug data-kind="data">Something look wrong?</button></p>
    </section>`;
  const body = root.querySelector<HTMLElement>("#prof-body")!;
  attachItemTips(root);
  wireAddButtons(root, (name) => toast(`${name} added to your crafting list`));

  if (tab === "about") {
    body.innerHTML = `<div class="about-grid">${about(prof) || `<p class="muted">Nothing more about ${esc(prof.name)} in the game files.</p>`}</div>`;
    return;
  }

  body.innerHTML = `
    <div class="ts-window">
      <div class="ts-top">
        <div class="ts-skill">
          <label for="skill" class="skillbar" id="skillbar">
            <span class="skillbar-fill" id="skillbar-fill"></span>
            <span class="skillbar-text">${esc(prof.name)} <input id="skill" type="number" inputmode="numeric" min="0" max="450" placeholder="?" value="${skill ?? ""}" aria-label="Your ${esc(prof.name)} skill" /> / ${SKILL_CAP}</span>
          </label>
          <p class="legend"><span class="d d-orange">Orange</span> always a skill-up <span class="d d-yellow">Yellow</span> usually <span class="d d-green">Green</span> sometimes <span class="d d-grey">Grey</span> never</p>
        </div>
        <div class="ts-filters">
          <input type="search" id="q" value="${esc(f.q)}" placeholder="Search recipes, results, reagents" aria-label="Search recipes" />
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
      <div class="ts-body">
        <div class="ts-listwrap">
          <p class="ts-count" id="count" aria-live="polite"></p>
          <ul class="ts-list" id="recipes"></ul>
          <div class="ts-more"><button class="btn small" id="more" hidden>Show more</button></div>
        </div>
        <div class="ts-detail" id="detail"></div>
      </div>
    </div>
    ${adSlot("leaderboard")}`;

  // Wide screens show the selected recipe beside the list; phones open the recipe page instead.
  const wide = matchMedia("(min-width: 980px)");
  let selected: number | null = Number(params.get("r")) || null;
  let shown = PAGE;
  const collapsed = new Set<number>();
  const catName = new Map(prof.categories.map((c) => [c.id, c.name]));
  const catOrder = new Map(prof.categories.map((c, i) => [c.id, i]));
  const draw = () => {
    if (!body.isConnected) return wide.removeEventListener("change", draw);
    const rows = prof.recipes.filter((r) => matches(r, f, skill));
    // Grouped under their categories, like the game's list; by skill-up range inside each.
    const sorted = prof.categories.length
      ? [...rows].sort((a, b) => (catOrder.get(a.cat ?? -1) ?? 999) - (catOrder.get(b.cat ?? -1) ?? 999))
      : rows;
    const visible = sorted.slice(0, shown);
    if (!selected || !rows.some((r) => r.spell === selected)) selected = visible[0]?.spell ?? null;
    let lastCat: number | undefined | null = null;
    body.querySelector("#recipes")!.innerHTML = visible.length
      ? visible
          .map((r) => {
            const cat = r.cat ?? -1;
            const head =
              prof.categories.length && r.cat !== lastCat
                ? `<li><button type="button" class="ts-group" data-cat="${cat}" aria-expanded="${!collapsed.has(cat)}">
                    <span class="ts-toggle" aria-hidden="true">${collapsed.has(cat) ? "+" : "−"}</span>${esc(catName.get(cat) ?? "Other")}</button></li>`
                : "";
            lastCat = r.cat;
            return head + (collapsed.has(cat) ? "" : recipeRow(slug, r, skill, wide.matches && r.spell === selected));
          })
          .join("")
      : `<li class="empty"><h3>No recipes match</h3><p>Try another search or filter.</p></li>`;
    body.querySelector("#count")!.textContent = `${rows.length} of ${prof.recipes.length} recipes`;
    body.querySelector<HTMLButtonElement>("#more")!.hidden = rows.length <= shown;
    drawDetail();
    const qs = new URLSearchParams();
    if (f.q) qs.set("q", f.q);
    if (f.cat) qs.set("cat", f.cat);
    if (f.show) qs.set("show", f.show);
    if (f.source) qs.set("source", f.source);
    history.replaceState(null, "", `/professions/${slug}${qs.size ? `?${qs}` : ""}`);
  };
  const drawSkill = () => {
    const fill = body.querySelector<HTMLElement>("#skillbar-fill");
    if (fill) fill.style.width = `${Math.min(100, ((skill ?? 0) / SKILL_CAP) * 100)}%`;
  };
  const drawDetail = () => {
    const r = prof.recipes.find((x) => x.spell === selected);
    body.querySelector("#detail")!.innerHTML = r ? recipeDetail(slug, r, skill) : "";
  };
  body.querySelector("#recipes")!.addEventListener("click", (e) => {
    const group = (e.target as Element).closest<HTMLButtonElement>("[data-cat]");
    if (group) {
      const cat = Number(group.dataset.cat);
      if (collapsed.has(cat)) collapsed.delete(cat);
      else collapsed.add(cat);
      draw();
      return;
    }
    const row = (e.target as Element).closest<HTMLAnchorElement>("[data-spell]");
    if (!row || !wide.matches || (e as MouseEvent).metaKey || (e as MouseEvent).ctrlKey) return;
    e.preventDefault();
    e.stopPropagation();
    selected = Number(row.dataset.spell);
    body.querySelectorAll('.ts-row[aria-current="true"]').forEach((el) => el.removeAttribute("aria-current"));
    row.setAttribute("aria-current", "true");
    drawDetail();
  }, true);
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
    drawSkill();
    draw();
  });
  body.querySelector("#more")!.addEventListener("click", () => {
    shown += PAGE;
    draw();
  });
  wide.addEventListener("change", draw);
  drawSkill();
  draw();
  fillAds(root);
}
