// Item database: search every item in the game client, and a detail page per item with its
// tooltip, how it compares with Classic Era, and profession links.

import { adSlot, fillAds, withListAds, withRail } from "../ads";
import { classColor, clientLabel, getMeta, iconUrl, QUALITY_COLOR } from "../data";
import {
  BIND_TEXT, coins, GEAR_SLOT, getItem, getItemDbMeta, getItemIndex, PRIMARY_STATS, QUALITY_NAME, SLOT_NAME,
  STAT_NAME, statLine, type ItemDetail, type ItemNumbers, type ItemRow, type ItemSpell,
} from "../itemdb";
import { openShare } from "../share";
import { diffWords, esc, gameText, setTitle } from "../ui";

const PAGE = 100;
/** One in-list ad per this many result rows. */
const LIST_AD_EVERY = 40;
const LEVEL_CAP = 60;
const SORTS = { ilvl: "Item level", req: "Required level", name: "Name" } as const;

const itemLink = (i: { id: number; name: string; q: number; icon?: string }, withIcon = true) =>
  `<a class="item-link" href="/items/${i.id}" data-link style="--q:${QUALITY_COLOR[i.q] ?? QUALITY_COLOR[1]}">${
    withIcon && i.icon ? `<img src="${iconUrl(i.icon)}" alt="" loading="lazy" />` : ""
  }<span>${esc(i.name)}</span></a>`;

// ------------------------------------------------------------------ list

interface ListState {
  search: string;
  type: string;
  sub: string;
  slot: string;
  quality: string;
  min: string;
  max: string;
  status: string;
  sort: keyof typeof SORTS;
}

function readState(params: URLSearchParams): ListState {
  const sort = params.get("sort") ?? "ilvl";
  return {
    search: params.get("search") ?? "",
    type: params.get("type") ?? "",
    sub: params.get("sub") ?? "",
    slot: params.get("slot") ?? "",
    quality: params.get("quality") ?? "",
    min: params.get("min") ?? "",
    max: params.get("max") ?? "",
    status: ["new", "changed"].includes(params.get("status") ?? "") ? params.get("status")! : "",
    sort: sort in SORTS ? (sort as keyof typeof SORTS) : "ilvl",
  };
}

export async function renderItemList(root: HTMLElement, params: URLSearchParams) {
  setTitle("WoW Forever Item Database", "Every item in World of Warcraft: Forever, with stats, effects and what changed since Classic Era.");
  const [{ rows, build, classicBuild }, meta, siteMeta] = await Promise.all([getItemIndex(), getItemDbMeta(), getMeta()]);
  const state = readState(params);
  const className = new Map(meta.classes.map((c) => [c.id, c.name]));
  const subName = new Map(meta.classes.flatMap((c) => c.subs.map((s) => [`${c.id}:${s.id}`, s.name] as const)));
  const counts = { new: rows.filter((r) => r.flag === 1).length, changed: rows.filter((r) => r.flag === 2).length };

  root.innerHTML = `
    <section class="page items-page">
      <header class="page-head">
        <div>
          <h1>Item database</h1>
          <p class="lede">${rows.length.toLocaleString()} items from the Forever ${esc(clientLabel(siteMeta))} (build ${esc(build.split(".").pop()!)}).
            ${counts.new.toLocaleString()} of them don't exist in Classic Era ${esc(classicBuild)}, and ${counts.changed.toLocaleString()} work differently.</p>
        </div>
      </header>
      ${withRail(`<form class="item-filters" id="item-filters" role="search">
        <input type="search" name="search" placeholder="Search item names" value="${esc(state.search)}" aria-label="Search item names" autocomplete="off" />
        <select name="type" aria-label="Type">
          <option value="">All types</option>
          ${meta.classes.map((c) => `<option value="${c.id}" ${String(c.id) === state.type ? "selected" : ""}>${esc(c.name)} (${c.count.toLocaleString()})</option>`).join("")}
        </select>
        <select name="sub" aria-label="Subtype" ${state.type ? "" : "disabled"}>
          <option value="">All subtypes</option>
          ${(meta.classes.find((c) => String(c.id) === state.type)?.subs ?? [])
            .map((s) => `<option value="${s.id}" ${String(s.id) === state.sub ? "selected" : ""}>${esc(s.name)}</option>`)
            .join("")}
        </select>
        <select name="slot" aria-label="Slot">
          <option value="">Any slot</option>
          ${[...new Set(Object.values(SLOT_NAME))]
            .map((name) => `<option value="${esc(name)}" ${name === state.slot ? "selected" : ""}>${esc(name)}</option>`)
            .join("")}
        </select>
        <select name="quality" aria-label="Quality">
          <option value="">Any quality</option>
          ${QUALITY_NAME.slice(0, 6).map((q, i) => `<option value="${i}" ${String(i) === state.quality ? "selected" : ""}>${q}</option>`).join("")}
        </select>
        <label class="lvl-range">Level
          <input type="number" name="min" min="0" max="60" placeholder="0" value="${esc(state.min)}" aria-label="Minimum required level" />
          –
          <input type="number" name="max" min="0" max="60" placeholder="60" value="${esc(state.max)}" aria-label="Maximum required level" />
        </label>
        <select name="sort" aria-label="Sort by">
          ${Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${k === state.sort ? "selected" : ""}>Sort: ${v}</option>`).join("")}
        </select>
      </form>
      <nav class="seg item-status" aria-label="Compared with Classic Era">
        ${[["", "All items"], ["new", "New in Forever"], ["changed", "Changed from Classic"]]
          .map(([id, label]) => `<a href="#" data-status="${id}" class="${state.status === id ? "active" : ""}">${label}</a>`)
          .join("")}
      </nav>
      <p class="muted small" id="item-count" aria-live="polite"></p>
      <div class="item-row item-head" aria-hidden="true"><span></span><span>Name</span><span class="item-row-type">Type</span><span class="item-row-num">iLvl</span><span class="item-row-num">Req</span><span class="item-row-status"></span></div>
      <div class="item-table" id="item-results" role="list"></div>
      <div class="more" id="item-more"></div>
      <p class="data-note">Stats, effects and prices are read from the game client. Drop locations and vendors aren't in there, so you won't find them here.</p>`)}
    </section>`;

  const form = root.querySelector<HTMLFormElement>("#item-filters")!;
  const results = root.querySelector<HTMLElement>("#item-results")!;
  const more = root.querySelector<HTMLElement>("#item-more")!;
  const count = root.querySelector<HTMLElement>("#item-count")!;
  let shown = 0;
  let matches: ItemRow[] = [];

  const typeLabel = (r: ItemRow) => {
    const sub = subName.get(`${r.cls}:${r.sub}`);
    const slot = SLOT_NAME[r.slot];
    if (r.cls === 2 || r.cls === 4) return [slot, sub].filter(Boolean).join(" · ");
    return sub && sub !== className.get(r.cls) ? `${className.get(r.cls)} · ${sub}` : className.get(r.cls) ?? "";
  };
  const row = (r: ItemRow) => `<a class="item-row" role="listitem" href="/items/${r.id}" data-link style="--q:${QUALITY_COLOR[r.q] ?? QUALITY_COLOR[1]}">
      <img src="${iconUrl(r.icon)}" alt="" loading="lazy" />
      <span class="item-row-name">${esc(r.name)}</span>
      <span class="item-row-type">${esc(typeLabel(r))}</span>
      <span class="item-row-num" title="Item level">${r.ilvl}</span>
      <span class="item-row-num" title="Required level">${r.req || "–"}</span>
      <span class="item-row-status">${r.flag === 1 ? `<span class="badge st-new">New</span>` : r.flag === 2 ? `<span class="badge st-tuned">Changed</span>` : ""}</span>
    </a>`;

  const showMore = () => {
    const page = matches.slice(shown, shown + PAGE);
    // In-list ads only on the first render and on "Show more": re-rendering on every keystroke
    // would request new ads each time, which AdSense doesn't allow.
    results.insertAdjacentHTML("beforeend", listAds ? withListAds(page, row, LIST_AD_EVERY, shown) : page.map(row).join(""));
    fillAds(results);
    shown = Math.min(shown + PAGE, matches.length);
    more.innerHTML = shown < matches.length ? `<button class="btn" type="button">Show ${Math.min(PAGE, matches.length - shown)} more</button>` : "";
  };
  let listAds = true;
  more.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("button")) showMore();
  });

  const apply = () => {
    const words = state.search.toLowerCase().split(/\s+/).filter(Boolean);
    const min = Number(state.min) || 0;
    const max = state.max === "" ? 99 : Number(state.max);
    matches = rows.filter(
      (r) =>
        words.every((w) => r.lower.includes(w)) &&
        (!state.type || String(r.cls) === state.type) &&
        (!state.sub || String(r.sub) === state.sub) &&
        (!state.slot || SLOT_NAME[r.slot] === state.slot) &&
        (state.quality === "" || String(r.q) === state.quality) &&
        r.req >= min &&
        r.req <= max &&
        (!state.status || r.flag === (state.status === "new" ? 1 : 2)),
    );
    if (state.sort === "name") matches.sort((a, b) => a.name.localeCompare(b.name));
    else if (state.sort === "req") matches.sort((a, b) => Number(a.req > LEVEL_CAP) - Number(b.req > LEVEL_CAP) || b.req - a.req || b.ilvl - a.ilvl || a.name.localeCompare(b.name));
    // index.json is already sorted by item level (items above the level cap last)
    count.textContent = `${matches.length.toLocaleString()} item${matches.length === 1 ? "" : "s"}`;
    results.innerHTML = matches.length ? "" : `<div class="empty"><h3>No items match</h3><p>Try fewer filters or a shorter search.</p></div>`;
    shown = 0;
    showMore();
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(state)) if (v && !(k === "sort" && v === "ilvl")) qs.set(k, v);
    history.replaceState(null, "", `/items${qs.size ? `?${qs}` : ""}`);
  };

  let timer = 0;
  form.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    (state as unknown as Record<string, string>)[el.name] = el.value;
    if (el.name === "type") {
      state.sub = "";
      const subs = meta.classes.find((c) => String(c.id) === el.value)?.subs ?? [];
      const sub = form.elements.namedItem("sub") as HTMLSelectElement;
      sub.innerHTML = `<option value="">All subtypes</option>${subs.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}`;
      sub.disabled = !el.value;
    }
    listAds = false;
    clearTimeout(timer);
    timer = window.setTimeout(apply, el.name === "search" ? 120 : 0);
  });
  form.addEventListener("submit", (e) => e.preventDefault());
  root.querySelector(".item-status")!.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("[data-status]");
    if (!a) return;
    e.preventDefault();
    state.status = a.dataset.status!;
    root.querySelectorAll(".item-status a").forEach((x) => x.classList.toggle("active", x === a));
    apply();
  });
  apply();
  fillAds(root);
}

// ------------------------------------------------------------------ detail

const cooldown = (s: number) => (s >= 3600 ? `${s / 3600} hour` : s >= 60 ? `${Math.round(s / 60)} min` : `${s} sec`);

function spellLine(sp: ItemSpell) {
  const prefix = { use: "Use", equip: "Equip", hit: "Chance on hit" }[sp.on];
  return `<p class="tt-green">${prefix}: ${gameText(sp.text)}${sp.cd ? ` (${cooldown(sp.cd)} Cooldown)` : ""}</p>`;
}

function money(copper: number) {
  const [g, s, c] = coins(copper);
  return [g && `<span class="coin gold">${g}</span>`, s && `<span class="coin silver">${s}</span>`, (c || (!g && !s)) && `<span class="coin copper">${c}</span>`]
    .filter(Boolean)
    .join(" ");
}

function tooltip(d: ItemDetail, typeName: string, classNames: Map<string, string>) {
  const lines: string[] = [];
  const add = (html: string, cls = "") => lines.push(`<p${cls ? ` class="${cls}"` : ""}>${html}</p>`);
  if (d.bind) add(BIND_TEXT[d.bind] ?? "");
  if (d.unique) add("Unique");
  if (d.quest) add("This Item Begins a Quest", "tt-gold");
  const slot = SLOT_NAME[d.slot];
  if (slot || (d.cls === 2 || d.cls === 4)) lines.push(`<p class="tt-split"><span>${esc(slot ?? "")}</span><span>${esc(typeName)}</span></p>`);
  if (d.bag) add(`${d.bag} Slot ${d.cls === 11 ? "Quiver" : "Bag"}`);
  if (d.dmg) {
    lines.push(`<p class="tt-split"><span>${d.dmg.min} - ${d.dmg.max}${d.school ? ` ${esc(d.school)}` : ""} Damage</span><span>Speed ${d.dmg.speed.toFixed(2)}</span></p>`);
    if (d.dmg.bonus) add(`+${d.dmg.bonus.min} - ${d.dmg.bonus.max} ${esc(d.dmg.bonus.school)} Damage`);
    add(`(${d.dmg.dps.toFixed(1)} damage per second)`);
  } else if (d.dmg === null) {
    add("Weapon damage isn't derivable from the game client data for this weapon.", "tt-unknown");
  }
  if (d.armor) add(`${d.armor} Armor`);
  for (const k of PRIMARY_STATS) if (d.stats[k]) add(statLine(k, d.stats[k]));
  if (d.classes) add(`Classes: ${d.classes.map((c) => `<span style="color:${classColor(c)}">${esc(classNames.get(c) ?? c)}</span>`).join(", ")}`);
  if (d.faction) add(`${d.faction} only`);
  if (d.races) add(`Races: ${d.races.map(esc).join(", ")}`);
  if (d.req > 1) add(`Requires Level ${d.req}`);
  if (d.req > LEVEL_CAP) add(`That's above WoW Forever's level cap of ${LEVEL_CAP}: the item ships in the client files, but no character can use it.`, "tt-unknown");
  if (d.skill) add(`Requires ${esc(d.skill.name)} (${d.skill.rank})`);
  if (d.rep) add(`Requires ${esc(d.rep.faction)} - ${esc(d.rep.standing)}`);
  if (d.pvpRank) add(`Requires PvP rank ${d.pvpRank}`);
  for (const [k, v] of Object.entries(d.stats)) if (!PRIMARY_STATS.includes(k)) add(`Equip: ${statLine(k, v)}`, "tt-green");
  for (const o of d.other ?? []) {
    if ("label" in o) add(`Equip: +? ${esc(o.label)}`, "tt-green");
    else add(`Equip: a bonus of a type Forever added (#${o.type}) that isn't identified yet`, "tt-unknown");
  }
  for (const sp of d.spells ?? []) lines.push(spellLine(sp));
  if (d.teaches && !(d.spells ?? []).some((s) => s.on === "use")) lines.push(`<p class="tt-green">Use: Teaches you how to make ${itemLink(d.teaches, false)}.</p>`);
  if (d.set) {
    lines.push(`<div class="tt-set"><p class="tt-gold">${esc(d.set.name)} (${d.set.items.length} pieces)</p>
      ${d.set.items.map((i) => `<p class="tt-set-item">${i.id === d.id ? esc(i.name) : itemLink(i, false)}</p>`).join("")}
      ${d.set.bonuses.map((b) => `<p class="tt-set-bonus">(${b.n}) Set: ${gameText(b.text)}</p>`).join("")}</div>`);
  }
  // Forever recipe items repeat "Teaches you how to make X." as their description; the Use line says it already.
  if (d.flavor && !(d.teaches && /^Teaches you how to /.test(d.flavor))) add(`“${esc(d.flavor)}”`, "tt-flavor");
  if (d.stack) add(`Max Stack: ${d.stack}`, "tt-muted");
  if (d.sell) add(`Sell Price: ${money(d.sell)}`, "tt-muted");
  return `<div class="item-tooltip" style="--q:${QUALITY_COLOR[d.q] ?? QUALITY_COLOR[1]}">
      <header><img src="${iconUrl(d.icon)}" alt="" /><h1>${esc(d.name)}</h1></header>
      ${lines.join("")}
    </div>`;
}

const RATING_PAIRS: [string, string, string][] = [
  ["critpct", "crit", "Critical strike"], ["hitpct", "hit", "Hit"], ["dodgepct", "dodge", "Dodge"],
  ["parrypct", "parry", "Parry"], ["blockpct", "block", "Block"],
];

const dmgText = (x?: ItemNumbers["dmg"]) => (x ? `${x.min}–${x.max} · ${x.speed.toFixed(2)} speed · ${x.dps.toFixed(1)} DPS` : x === null ? "unknown" : "–");

function comparison(d: ItemDetail) {
  const c = d.classic!;
  const rows: string[] = [];
  const row = (label: string, before: string, after: string) =>
    rows.push(`<tr><th scope="row">${label}</th><td>${before}</td><td>${after}</td></tr>`);
  const has = (k: string) => d.changes?.includes(k as never);
  if (has("name")) row("Name", esc(c.name), esc(d.name));
  if (has("q")) row("Quality", `<span style="color:${QUALITY_COLOR[c.q]}">${QUALITY_NAME[c.q]}</span>`, `<span style="color:${QUALITY_COLOR[d.q]}">${QUALITY_NAME[d.q]}</span>`);
  if (has("ilvl")) row("Item level", String(c.ilvl), String(d.ilvl));
  if (has("req")) row("Required level", String(c.req || "–"), String(d.req || "–"));
  if (has("armor")) {
    // Compared as totals (base + bonus armor), like the pipeline does.
    const total = (x: ItemNumbers) => (x.armor ?? 0) + (x.stats.armor ?? 0);
    const detail = (x: ItemNumbers) => (x.stats.armor ? ` <span class="muted small">(${x.armor ?? 0} + ${x.stats.armor} bonus)</span>` : "");
    row("Armor", `${total(c) || "–"}${detail(c)}`, `${total(d) || "–"}${detail(d)}`);
  }
  if (has("dmg")) row("Damage", dmgText(c.dmg), dmgText(d.dmg));
  if (has("stats")) {
    const now = d.cmpStats ?? d.stats;
    const paired = new Set<string>();
    // Classic percent chances and the Forever ratings that replaced them share one row.
    for (const [pct, rating, label] of RATING_PAIRS) {
      if (c.stats[pct] && now[rating] && !c.stats[rating] && !now[pct]) {
        row(label, esc(statLine(pct, c.stats[pct])), esc(statLine(rating, now[rating])));
        paired.add(pct).add(rating);
      }
    }
    const keys = [...new Set([...Object.keys(c.stats), ...Object.keys(now)])].filter((k) => !paired.has(k) && k !== "armor");
    for (const k of keys) {
      const a = c.stats[k];
      const b = now[k];
      if (a === b) continue;
      row(esc((STAT_NAME[k] ?? k).replace(/^% /, "")), a ? esc(statLine(k, a)) : "–", b ? esc(statLine(k, b)) : "–");
    }
    for (const o of d.other ?? []) row("Other bonus", "–", "label" in o ? `+? ${esc(o.label)}` : `unidentified (#${o.type})`);
  }
  let effects = "";
  if (has("effects")) {
    const before = c.spells ?? [];
    const after = (d.spells ?? []).filter((s) => !/^Teaches you how to /.test(s.text));
    const n = Math.max(before.length, after.length);
    const pairs: string[] = [];
    for (let i = 0; i < n; i++) {
      const a = before[i];
      const b = after[i];
      const diff = a && b ? diffWords(a.text, b.text) : { before: a ? gameText(a.text) : "", after: b ? gameText(b.text) : "" };
      pairs.push(`<div class="before-after">
          <p><span class="label">Classic${a ? ` · ${a.on}` : ""}</span>${a ? diff.before : `<span class="muted">No effect</span>`}</p>
          <p><span class="label">Forever${b ? ` · ${b.on}` : ""}</span>${b ? diff.after : `<span class="muted">No effect</span>`}</p>
        </div>`);
    }
    effects = `<h3 class="cmp-sub">Effects</h3>${pairs.join("")}`;
  }
  return `${rows.length ? `<table class="cmp-table"><thead><tr><th></th><th>Classic Era</th><th>Forever</th></tr></thead><tbody>${rows.join("")}</tbody></table>` : ""}${effects}`;
}

function recipeList(list: ItemDetail["createdBy"], withMakes: boolean) {
  return `<ul class="recipe-refs">${(list ?? [])
    .map(
      (r) => `<li>${withMakes && r.makes ? itemLink(r.makes) : `<span>${esc(r.name)}</span>`}
        <a class="muted small" href="/professions/${esc(r.prof)}?q=${encodeURIComponent(r.name)}" data-link>${esc(r.profName)}</a></li>`,
    )
    .join("")}</ul>`;
}

export async function renderItem(root: HTMLElement, id: number) {
  const [d, meta, siteMeta, { classicBuild }] = await Promise.all([getItem(id), getItemDbMeta(), getMeta(), getItemIndex()]);
  if (!d) {
    setTitle("Item not found");
    root.innerHTML = `<section class="page"><div class="empty"><h1>Item not found</h1>
      <p>There's no item #${id} in the game client (or it's an internal test item).</p>
      <a class="btn" href="/items" data-link>Search items</a></div></section>`;
    return;
  }
  const cls = meta.classes.find((c) => c.id === d.cls);
  const typeName = cls?.subs.find((s) => s.id === d.sub)?.name ?? cls?.name ?? "";
  const classNames = new Map(siteMeta.classes.map((c) => [c.slug, c.name]));
  setTitle(`${d.name} (WoW Forever item)`, `${d.name}: ${QUALITY_NAME[d.q]} ${typeName.toLowerCase()} in WoW Forever${d.status === "changed" ? ", changed since Classic Era" : d.status === "new" ? ", new in Forever" : ""}.`);
  const gearSlot = GEAR_SLOT[d.slot];

  const status =
    d.status === "new"
      ? `<p><span class="badge st-new">New in Forever</span></p><p class="muted">No item with this ID or name exists in Classic Era ${esc(classicBuild)}.</p>`
      : d.status === "same"
        ? `<p><span class="badge st-unchanged">Same as Classic</span></p><p class="muted">Stats, effects and requirements match Classic Era ${esc(classicBuild)}${
            d.classicId ? ` (item #${d.classicId} there)` : ""
          }. Wording differences aren't counted.</p>`
        : `<p><span class="badge st-tuned">Changed from Classic</span></p>
           <p class="muted">Compared with Classic Era ${esc(classicBuild)}${d.classicId ? ` (item #${d.classicId} there)` : ""}. Only differences are shown.</p>
           ${comparison(d)}`;

  root.innerHTML = `
    <section class="page item-page">
      <nav class="crumbs"><a href="/items" data-link>Items</a> / <a href="/items?type=${d.cls}" data-link>${esc(cls?.name ?? "")}</a>${
        typeName && typeName !== cls?.name ? ` / <a href="/items?type=${d.cls}&sub=${d.sub}" data-link>${esc(typeName)}</a>` : ""
      }</nav>
      <div class="item-layout">
        <div class="item-main">
          ${tooltip(d, typeName, classNames)}
          <div class="item-actions">
            <button class="btn small" id="copy-item">Share</button>
            ${gearSlot ? `<a class="btn small" href="/gear?i=${gearSlot}:${d.id}" data-link>Try in gear sandbox</a>` : ""}
          </div>
          <dl class="item-facts">
            <div><dt>Item ID</dt><dd>${d.id}</dd></div>
            <div><dt>Item level</dt><dd>${d.ilvl}</dd></div>
            <div><dt>Quality</dt><dd style="color:${QUALITY_COLOR[d.q]}">${QUALITY_NAME[d.q]}</dd></div>
            <div><dt>Type</dt><dd>${esc([cls?.name, typeName !== cls?.name ? typeName : ""].filter(Boolean).join(" · "))}</dd></div>
          </dl>
        </div>
        <div class="item-side">
          <section class="panel"><h2>Compared with Classic Era</h2>${status}</section>
          ${d.createdBy ? `<section class="panel"><h2>Created by</h2>${recipeList(d.createdBy, false)}</section>` : ""}
          ${d.reagentFor ? `<section class="panel"><h2>Reagent for</h2>${recipeList(d.reagentFor, true)}</section>` : ""}
          ${adSlot("rectangle")}
          <p class="data-note">Data from the ${esc(clientLabel(siteMeta))}, build ${esc(siteMeta.build)}. Where it drops or who sells it isn't in the client data.
            <button type="button" class="link-btn" data-report-bug data-kind="data">Something look wrong?</button></p>
        </div>
      </div>
    </section>`;
  root.querySelector("#copy-item")!.addEventListener("click", () =>
    openShare({ url: `${location.origin}/items/${d.id}`, text: `${d.name} in WoW Forever` }),
  );
  fillAds(root);
}
