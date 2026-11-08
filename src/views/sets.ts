// Item sets: every set a player can wear in Forever, with its pieces, bonuses and what changed
// from Classic Era (pipeline/itemdb.py build_sets). Drop sources aren't in the client, so there
// are none here.

import { adSlot, fillAds, withRail } from "../ads";
import { classColor, clientLabel, getMeta, iconUrl, load, QUALITY_COLOR } from "../data";
import { GEAR_SLOT, SLOT_NAME, statLine } from "../itemdb";
import { openShare } from "../share";
import { diffWords, esc, gameText, setTitle } from "../ui";
import { getModelIndex, modelUrl, mountViewer } from "../viewer3d";

export interface SetPiece {
  id: number;
  name: string;
  q: number;
  icon: string;
  slot: number;
  ilvl: number;
  req: number;
  cls: number;
  sub: number;
}

export interface SetBonus {
  n: number;
  text: string;
  status?: "new" | "changed";
  classic?: string;
}

export interface ItemSet {
  id: number;
  name: string;
  items: SetPiece[];
  bonuses: SetBonus[];
  classes?: string[];
  skill?: { name: string; rank: number };
  stats: Record<string, number>;
  armor?: number;
  status: "new" | "changed" | "same";
  classicName?: string;
  removedBonuses?: { n: number; text: string }[];
  addedItems?: number[];
  removedItems?: number[];
}

export const getSets = () => load<{ build: string; classicBuild: string; sets: ItemSet[] }>("sets.json");

const ARMOR = ["", "Cloth", "Leather", "Mail", "Plate"];
/** A class that wears the armor type, for opening sets without a class restriction in the gear sandbox. */
const ARMOR_CLASS: Record<string, string> = { Cloth: "mage", Leather: "rogue", Mail: "hunter", Plate: "warrior" };
/** The heaviest armor each class can wear (index into ARMOR). */
const MAX_ARMOR: Record<string, number> = { warrior: 4, paladin: 4, hunter: 3, shaman: 3, rogue: 2, druid: 2, priest: 1, mage: 1, warlock: 1 };
const canWear = (s: ItemSet, cls: string) =>
  s.classes ? s.classes.includes(cls) : ARMOR.indexOf(armorType(s)) <= (MAX_ARMOR[cls] ?? 4);

const topQuality = (s: ItemSet) => Math.max(...s.items.map((i) => i.q));
const levelRange = (s: ItemSet) => {
  const reqs = s.items.map((i) => i.req);
  const [lo, hi] = [Math.min(...reqs), Math.max(...reqs)];
  return lo === hi ? `Level ${lo || 1}` : `Level ${lo || 1}–${hi}`;
};
const armorType = (s: ItemSet) => {
  const subs = new Set(s.items.filter((i) => i.cls === 4 && i.sub >= 1 && i.sub <= 4).map((i) => i.sub));
  return subs.size === 1 ? ARMOR[[...subs][0]] : "";
};

/** The gear sandbox link that puts on every piece of the set (rings and trinkets fill both slots). */
export function sandboxLink(s: ItemSet, cls: string) {
  const used = new Set<string>();
  const parts = s.items.flatMap((i) => {
    let key = GEAR_SLOT[i.slot];
    if (!key) return [];
    if (used.has(key) && /1$/.test(key)) key = key.replace(/1$/, "2");
    if (used.has(key)) return [];
    used.add(key);
    return [`${key}:${i.id}`];
  });
  return `/gear/${cls}?i=${parts.join(",")}`;
}

/** The character screen's slots in the game's order: left column, right column, weapons. */
const DOLL: { key: string; name: string; types: number[] }[][] = [
  [
    { key: "head", name: "Head", types: [1] },
    { key: "neck", name: "Neck", types: [2] },
    { key: "shoulder", name: "Shoulder", types: [3] },
    { key: "back", name: "Back", types: [16] },
    { key: "chest", name: "Chest", types: [5, 20] },
    { key: "shirt", name: "Shirt", types: [4] },
    { key: "tabard", name: "Tabard", types: [19] },
    { key: "wrist", name: "Wrist", types: [9] },
  ],
  [
    { key: "hands", name: "Hands", types: [10] },
    { key: "waist", name: "Waist", types: [6] },
    { key: "legs", name: "Legs", types: [7] },
    { key: "feet", name: "Feet", types: [8] },
    { key: "finger1", name: "Finger", types: [11] },
    { key: "finger2", name: "Finger", types: [11] },
    { key: "trinket1", name: "Trinket", types: [12] },
    { key: "trinket2", name: "Trinket", types: [12] },
  ],
  [
    { key: "mh", name: "Main Hand", types: [13, 17, 21] },
    { key: "oh", name: "Off Hand", types: [14, 22, 23, 13] },
    { key: "ranged", name: "Ranged", types: [15, 25, 26, 28] },
  ],
];

/** Puts each piece in the first free slot that takes it (a second ring goes to the second finger). */
function dress(items: SetPiece[]) {
  const worn = new Map<string, SetPiece>();
  for (const i of items) {
    const slot = DOLL.flat().find((d) => d.types.includes(i.slot) && !worn.has(d.key));
    if (slot) worn.set(slot.key, i);
  }
  return worn;
}

// ------------------------------------------------------------------ list

export async function renderSetList(root: HTMLElement, params: URLSearchParams) {
  setTitle("WoW Forever Item Sets", "Every item set in World of Warcraft: Forever with its set bonuses, and what changed since Classic Era.");
  const [{ sets, build, classicBuild }, meta] = await Promise.all([getSets(), getMeta()]);
  const counts = { new: sets.filter((s) => s.status === "new").length, changed: sets.filter((s) => s.status === "changed").length };
  const state = {
    q: params.get("search") ?? "",
    cls: meta.classes.some((c) => c.slug === params.get("class")) ? params.get("class")! : "",
    status: params.get("status") === "new" || params.get("status") === "changed" ? params.get("status")! : "",
  };

  root.innerHTML = `
    <section class="page sets-page">
      <header class="page-head">
        <div>
          <h1>Item sets</h1>
          <p class="lede">${sets.length} sets you can wear in Forever, from the ${esc(clientLabel(meta))} (build ${esc(build.split(".").pop()!)}).
            <b>${counts.new}</b> are new, and <b>${counts.changed}</b> have different bonuses or pieces than in Classic Era ${esc(classicBuild)}.</p>
        </div>
      </header>
      ${withRail(`
      <form class="set-filters" id="set-filters" role="search">
        <input type="search" name="search" id="set-search" placeholder="Search sets and pieces" value="${esc(state.q)}" aria-label="Search sets" autocomplete="off" />
      </form>
      <nav class="seg" aria-label="Class">
        <a href="#" data-class="" class="${state.cls ? "" : "active"}">All classes</a>
        ${meta.classes.map((c) => `<a href="#" data-class="${c.slug}" style="--c:${classColor(c.slug)}" class="${state.cls === c.slug ? "active" : ""}">${esc(c.name)}</a>`).join("")}
      </nav>
      <nav class="seg" aria-label="Compared with Classic Era">
        ${[["", "All sets"], ["new", `New in Forever (${counts.new})`], ["changed", `Changed from Classic (${counts.changed})`]]
          .map(([id, label]) => `<a href="#" data-status="${id}" class="${state.status === id ? "active" : ""}">${label}</a>`)
          .join("")}
      </nav>
      <p class="muted small" id="set-count" aria-live="polite"></p>
      <div class="set-grid" id="set-grid"></div>
      <p class="data-note">Pieces, bonuses and stats come from the game client. Where a set drops isn't in there, so it isn't listed.
        <button type="button" class="link-btn" data-report-bug data-kind="data">Something look wrong?</button></p>`)}
    </section>`;

  const grid = root.querySelector<HTMLElement>("#set-grid")!;
  const count = root.querySelector<HTMLElement>("#set-count")!;
  const card = (s: ItemSet) => {
    const q = QUALITY_COLOR[topQuality(s)] ?? QUALITY_COLOR[1];
    const kind = [armorType(s), levelRange(s), `${s.items.length} pieces`].filter(Boolean).join(" · ");
    return `<a class="set-card" href="/sets/${s.id}" data-link style="--q:${q}">
      <div class="set-card-head">
        <b>${esc(s.name)}</b>
        ${s.status !== "same" ? `<span class="badge ${s.status === "new" ? "st-new" : "st-tuned"}">${s.status === "new" ? "New" : "Changed"}</span>` : ""}
      </div>
      <p class="set-card-meta">${esc(kind)}</p>
      ${s.classes ? `<p class="set-card-classes">${s.classes.map((c) => `<span class="class-pill" style="--class:${classColor(c)}">${esc(meta.classes.find((x) => x.slug === c)?.name ?? c)}</span>`).join("")}</p>` : ""}
      <div class="set-card-icons">${s.items.slice(0, 9).map((i) => `<img src="${iconUrl(i.icon)}" alt="" loading="lazy" />`).join("")}</div>
      <p class="set-card-bonus">${s.bonuses.length} bonus${s.bonuses.length === 1 ? "" : "es"}${
        s.bonuses.some((b) => b.status) ? ` · <span class="set-changed">${s.bonuses.filter((b) => b.status).length} different from Classic</span>` : ""
      }</p>
    </a>`;
  };

  const draw = () => {
    const q = state.q.trim().toLowerCase();
    const shown = sets.filter(
      (s) =>
        (!state.status || s.status === state.status) &&
        (!state.cls || canWear(s, state.cls)) &&
        (!q || s.name.toLowerCase().includes(q) || s.items.some((i) => i.name.toLowerCase().includes(q))),
    );
    count.textContent = `${shown.length} set${shown.length === 1 ? "" : "s"}${state.cls ? ` ${meta.classes.find((c) => c.slug === state.cls)?.name} can wear` : ""}`;
    grid.innerHTML = shown.length ? shown.map(card).join("") : `<p class="muted">No sets match.</p>`;
    const qs = new URLSearchParams();
    if (state.q) qs.set("search", state.q);
    if (state.cls) qs.set("class", state.cls);
    if (state.status) qs.set("status", state.status);
    history.replaceState(null, "", `/sets${qs.size ? `?${qs}` : ""}`);
  };

  root.querySelector("#set-search")!.addEventListener("input", (e) => ((state.q = (e.target as HTMLInputElement).value), draw()));
  root.querySelector("#set-filters")!.addEventListener("submit", (e) => e.preventDefault());
  root.querySelectorAll<HTMLAnchorElement>("[data-class], [data-status]").forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const key = "class" in a.dataset ? "cls" : "status";
      state[key] = (key === "cls" ? a.dataset.class : a.dataset.status) ?? "";
      a.parentElement!.querySelectorAll("a").forEach((x) => x.classList.toggle("active", x === a));
      draw();
    }),
  );
  draw();
  fillAds(root);
}

// ------------------------------------------------------------------ detail

export async function renderSet(root: HTMLElement, id: number) {
  const [{ sets, classicBuild }, meta] = await Promise.all([getSets(), getMeta()]);
  const s = sets.find((x) => x.id === id);
  if (!s) {
    setTitle("Set not found");
    root.innerHTML = `<section class="page"><div class="empty"><h1>Set not found</h1><p>There's no wearable set with that number in the game client.</p>
      <a class="btn" href="/sets" data-link>All sets</a></div></section>`;
    return;
  }
  setTitle(`${s.name} (WoW Forever set)`, `${s.name}: ${s.items.length} pieces and ${s.bonuses.length} set bonuses in World of Warcraft: Forever${
    s.status === "new" ? ", new in Forever" : s.status === "changed" ? ", changed since Classic Era" : ""
  }.`);
  const q = QUALITY_COLOR[topQuality(s)] ?? QUALITY_COLOR[1];
  const className = (slug: string) => meta.classes.find((c) => c.slug === slug)?.name ?? slug;
  const added = new Set(s.addedItems ?? []);
  const forClass = s.classes?.length === 1 ? s.classes[0] : null;

  const bonus = (b: SetBonus) => {
    const diff = b.classic ? diffWords(b.classic, b.text) : null;
    return `<li class="set-bonus ${b.status ? `is-${b.status}` : ""}">
      <span class="set-bonus-n" title="${b.n} pieces">${b.n}</span>
      <div>
        <p>${diff ? diff.after : gameText(b.text)}${b.status ? ` <span class="badge ${b.status === "new" ? "st-new" : "st-tuned"}">${b.status === "new" ? "New" : "Changed"}</span>` : ""}</p>
        ${diff ? `<p class="set-bonus-was"><span>Classic</span>${diff.before}</p>` : ""}
      </div>
    </li>`;
  };
  const statRows = Object.entries(s.stats)
    .filter(([, v]) => v)
    .map(([k, v]) => `<div><dt>${esc(statLine(k, v).replace(/^[+−]\d+(\.\d+)?\s?/, ""))}</dt><dd>${v > 0 ? "+" : "−"}${Math.abs(v)}</dd></div>`);
  if (s.armor) statRows.unshift(`<div><dt>Armor</dt><dd>${s.armor.toLocaleString()}</dd></div>`);

  const worn = dress(s.items);
  const slot = (d: (typeof DOLL)[number][number]) => {
    const i = worn.get(d.key);
    if (!i) return `<li class="cs-slot is-empty"><span class="cs-icon" title="${d.name}"></span><span class="cs-text"><span class="cs-slotname">${d.name}</span></span></li>`;
    return `<li class="cs-slot" style="--q:${QUALITY_COLOR[i.q] ?? QUALITY_COLOR[1]}"><a href="/items/${i.id}" data-link title="${esc(i.name)}">
      <img class="cs-icon" src="${iconUrl(i.icon)}" alt="${esc(i.name)}" />
      <span class="cs-text"><span class="cs-name">${esc(i.name)}</span>
        <span class="cs-slotname">${d.name} · ilvl ${i.ilvl}${added.has(i.id) ? ` <span class="badge st-new">New</span>` : ""}</span></span>
    </a></li>`;
  };
  const [left, right, weapons] = DOLL;

  root.innerHTML = `
    <section class="page set-page" style="--q:${q}">
      <nav class="crumbs"><a href="/sets" data-link>Item sets</a>${forClass ? ` / <a href="/sets?class=${forClass}" data-link>${esc(className(forClass))}</a>` : ""}</nav>
      <div class="char-screen">
        <header class="cs-head">
          <div>
            <h1>${esc(s.name)}</h1>
            <p class="cs-sub">${esc([armorType(s), levelRange(s), `${s.items.length} pieces`].filter(Boolean).join(" · "))}${
              s.skill ? ` · requires ${esc(s.skill.name)} (${s.skill.rank})` : ""
            }</p>
            ${s.classes ? `<p class="set-card-classes">${s.classes.map((c) => `<a class="class-pill" href="/talents/${c}" data-link style="--class:${classColor(c)}">${esc(className(c))}</a>`).join("")}</p>` : ""}
          </div>
          <div class="build-head-actions">
            <a class="btn primary" href="${sandboxLink(s, forClass ?? ARMOR_CLASS[armorType(s)] ?? "warrior")}" data-link>Try in gear sandbox</a>
            <button class="btn" id="share">Share</button>
          </div>
        </header>
        <div class="cs-body">
          <ul class="cs-col cs-left">${left.map(slot).join("")}</ul>
          <div class="cs-stage" id="cs-stage"></div>
          <ul class="cs-col cs-right">${right.map(slot).join("")}</ul>
          <ul class="cs-weapons">${weapons.map(slot).join("")}</ul>
        </div>
        <footer class="cs-foot">
          ${statRows.length ? `<dl class="cs-stats">${statRows.join("")}</dl>` : `<p class="muted small">No stats on the pieces themselves.</p>`}
          <p class="muted small">Every piece's stats added up, without the set bonuses.</p>
        </footer>
      </div>
      ${
        s.status === "new"
          ? `<div class="banner"><div><strong>New in Forever</strong><p class="muted">Classic Era ${esc(classicBuild)} doesn't have this set.</p></div></div>`
          : s.status === "changed"
            ? `<div class="banner"><div><strong>Changed from Classic</strong><p class="muted">${esc(
                [
                  s.classicName ? `called “${s.classicName}” in Classic Era` : "",
                  s.bonuses.some((b) => b.status) ? `${s.bonuses.filter((b) => b.status).length} bonus${s.bonuses.filter((b) => b.status).length === 1 ? " differs" : "es differ"}` : "",
                  s.removedBonuses?.length ? `${s.removedBonuses.length} Classic bonus${s.removedBonuses.length === 1 ? " is" : "es are"} gone` : "",
                  s.addedItems?.length ? `${s.addedItems.length} piece${s.addedItems.length === 1 ? " is" : "s are"} new` : "",
                  s.removedItems?.length ? `${s.removedItems.length} Classic piece${s.removedItems.length === 1 ? " was" : "s were"} replaced` : "",
                ]
                  .filter(Boolean)
                  .join(", "),
              )}. Compared with Classic Era ${esc(classicBuild)}.</p></div></div>`
            : ""
      }
      <h2 class="section-title">Set bonuses</h2>
      <ol class="set-bonuses">${s.bonuses.map(bonus).join("")}</ol>
      ${
        s.removedBonuses?.length
          ? `<h3 class="set-sub">Classic bonuses that are gone</h3><ol class="set-bonuses removed">${s.removedBonuses
              .map((b) => `<li class="set-bonus"><span class="set-bonus-n">${b.n}</span><div><p>${gameText(b.text)}</p></div></li>`)
              .join("")}</ol>`
          : ""
      }
      <div class="set-pieces-list">
        <h2 class="section-title">Pieces</h2>
        <ul class="set-pieces">${s.items
          .map(
            (i) => `<li><a href="/items/${i.id}" data-link style="--q:${QUALITY_COLOR[i.q] ?? QUALITY_COLOR[1]}">
              <img src="${iconUrl(i.icon)}" alt="" loading="lazy" />
              <span class="set-piece-name">${esc(i.name)}</span>
              <span class="set-piece-slot">${esc(SLOT_NAME[i.slot] ?? "")}</span>
              <span class="set-piece-num" title="Item level">${i.ilvl}</span>
              ${added.has(i.id) ? `<span class="badge st-new">New</span>` : `<span></span>`}
            </a></li>`,
          )
          .join("")}</ul>
      </div>
      ${adSlot("leaderboard")}
      <p class="data-note">Pieces and bonuses come from the game client and are compared with Classic Era ${esc(classicBuild)}. Only numbers count as a change:
        Forever shows Classic's “90 to 110” as its middle value, and often spells out proc chances Classic leaves out.
        <button type="button" class="link-btn" data-report-bug data-kind="data">Something look wrong?</button></p>
    </section>`;

  root.querySelector("#share")!.addEventListener("click", () =>
    openShare({ url: `${location.origin}/sets/${s.id}`, text: `${s.name}: set bonuses in WoW Forever` }),
  );
  fillAds(root);
  showModel(root, s);
}

/** The 3D character in the middle of the screen, for sets that have a model built (scripts/model3d). */
async function showModel(root: HTMLElement, s: ItemSet) {
  const models = (await getModelIndex())?.sets[String(s.id)];
  const stage = root.querySelector<HTMLElement>("#cs-stage");
  if (!stage) return;
  if (!models?.length) {
    stage.innerHTML = `<p class="cs-stage-empty">No 3D model of this set yet</p>`;
    return;
  }
  stage.innerHTML = `<div class="viewer-3d" id="viewer-3d" role="img" aria-label="${esc(s.name)} on a ${esc(models[0].label)} character, in 3D">
      <p class="viewer-loading">Loading 3D model…</p></div>
    <p class="cs-stage-note">${esc(models[0].label)} · drag to turn<span class="cs-zoom-hint">, scroll to zoom</span></p>`;
  const host = stage.querySelector<HTMLElement>("#viewer-3d")!;
  try {
    await mountViewer(host, modelUrl(models[0].file));
    host.querySelector(".viewer-loading")?.remove();
  } catch {
    host.querySelector(".viewer-loading")!.textContent = "The 3D model couldn't be loaded.";
  }
}
