// The in-game item tooltip: on item pages, and floating over item icons elsewhere (hover on a
// mouse, tap on a phone). Item details load lazily from the item database shards.

import { classColor, getMeta, iconUrl, QUALITY_COLOR } from "./data";
import { BIND_TEXT, coins, getItem, getItemDbMeta, PRIMARY_STATS, SLOT_NAME, statLine, type ItemDetail, type ItemSpell } from "./itemdb";
import { esc, gameText } from "./ui";

export const LEVEL_CAP = 60;

export const itemLink = (i: { id: number; name: string; q: number; icon?: string }, withIcon = true) =>
  `<a class="item-link" href="/items/${i.id}" data-link style="--q:${QUALITY_COLOR[i.q] ?? QUALITY_COLOR[1]}">${
    withIcon && i.icon ? `<img src="${iconUrl(i.icon)}" alt="" loading="lazy" />` : ""
  }<span>${esc(i.name)}</span></a>`;

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

export interface TooltipOptions {
  /** A floating tooltip: the name isn't the page's heading. */
  floating?: boolean;
  /** Set pieces being worn: they light up in the set list, and the bonuses they reach turn green, like in game. */
  worn?: Set<number>;
}

/** The game's item tooltip. */
export function itemTooltip(d: ItemDetail, typeName: string, classNames: Map<string, string>, opts: TooltipOptions = {}) {
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
    const worn = opts.worn;
    const wornCount = worn ? d.set.items.filter((i) => worn.has(i.id)).length : 0;
    lines.push(`<div class="tt-set"><p class="tt-gold">${esc(d.set.name)} (${worn ? `${wornCount}/` : ""}${d.set.items.length})</p>
      ${d.set.items.map((i) => `<p class="tt-set-item${worn?.has(i.id) ? " on" : ""}">${i.id === d.id || opts.floating ? esc(i.name) : itemLink(i, false)}</p>`).join("")}
      ${d.set.bonuses.map((b) => `<p class="tt-set-bonus${wornCount >= b.n ? " on" : ""}">(${b.n}) Set: ${gameText(b.text)}</p>`).join("")}</div>`);
  }
  // Forever recipe items repeat "Teaches you how to make X." as their description; the Use line says it already.
  if (d.flavor && !(d.teaches && /^Teaches you how to /.test(d.flavor))) add(`“${esc(d.flavor)}”`, "tt-flavor");
  if (d.stack) add(`Max Stack: ${d.stack}`, "tt-muted");
  if (d.sell) add(`Sell Price: ${money(d.sell)}`, "tt-muted");
  const name = opts.floating ? `<p class="tt-name">${esc(d.name)}</p>` : `<h1>${esc(d.name)}</h1>`;
  return `<div class="item-tooltip${opts.floating ? " floating" : ""}" style="--q:${QUALITY_COLOR[d.q] ?? QUALITY_COLOR[1]}">
      <header>${opts.floating ? "" : `<img src="${iconUrl(d.icon)}" alt="" />`}${name}</header>
      ${lines.join("")}
    </div>`;
}


// ------------------------------------------------------------------ floating tooltips

let tip: HTMLElement | null = null;
let owner: HTMLElement | null = null;
let pending = 0;

function closeTip() {
  tip?.remove();
  tip = owner = null;
  pending++;
}

const attached = new WeakMap<HTMLElement, TooltipOptions>();
let listening = false;
function listenOnce() {
  if (listening) return;
  listening = true;
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeTip());
  // A tap outside closes the sheet; following a link (the router swaps the page) closes any tooltip.
  document.addEventListener("pointerdown", (e) => {
    const t = e.target as Node;
    if (tip && !tip.contains(t) && !owner?.contains(t)) closeTip();
  });
  document.addEventListener("click", (e) => {
    const t = e.target as Element;
    if (t.closest?.("[data-tip-close]") || (t.closest?.("a[data-link]") && !e.defaultPrevented)) closeTip();
  });
  addEventListener("scroll", () => tip?.classList.contains("tip-float") && closeTip(), { passive: true });
  addEventListener("popstate", closeTip);
}

async function tooltipHtml(id: number, opts: TooltipOptions) {
  const [d, meta, siteMeta] = await Promise.all([getItem(id), getItemDbMeta(), getMeta()]);
  if (!d) return null;
  const cls = meta.classes.find((c) => c.id === d.cls);
  const typeName = cls?.subs.find((s) => s.id === d.sub)?.name ?? cls?.name ?? "";
  return itemTooltip(d, typeName, new Map(siteMeta.classes.map((c) => [c.slug, c.name])), { ...opts, floating: true });
}

/** Beside the element, on whichever side has room, kept inside the window. */
function place(el: HTMLElement, anchor: HTMLElement) {
  const a = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const gap = 10;
  let x = a.right + gap;
  if (x + w > innerWidth - 8) x = a.left - gap - w;
  x = Math.max(8, Math.min(x, innerWidth - w - 8));
  const y = Math.max(8, Math.min(a.top, innerHeight - h - 8));
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

async function showTip(anchor: HTMLElement, sheet: boolean, opts: TooltipOptions) {
  const id = Number(anchor.dataset.tipItem);
  const mine = ++pending;
  owner = anchor;
  const html = await tooltipHtml(id, opts);
  if (mine !== pending || !html || !anchor.isConnected) return;
  tip?.remove();
  tip = document.createElement("div");
  tip.className = sheet ? "tip-sheet" : "tip-float";
  tip.setAttribute("role", sheet ? "dialog" : "tooltip");
  tip.innerHTML = sheet
    ? `${html}<div class="tip-sheet-actions"><a class="btn primary" href="/items/${id}" data-link>Open item page</a><button class="btn" type="button" data-tip-close>Close</button></div>`
    : html;
  document.body.append(tip);
  if (!sheet) place(tip, anchor);
}

/**
 * In-game tooltips for every `[data-tip-item="<item id>"]` element in `root`. With a mouse they show on
 * hover or keyboard focus and a click opens the item; on touch screens the first tap opens the
 * tooltip as a sheet at the bottom of the screen (with a link to the item page), like holding an item in game.
 */
export function attachItemTips(root: HTMLElement, options: TooltipOptions = {}) {
  listenOnce();
  // Views render into the same root again and again: listen once per root, with the latest options.
  const first = !attached.has(root);
  attached.set(root, options);
  if (!first) return;
  const opts = () => attached.get(root) ?? {};
  const mouse = matchMedia("(hover: hover) and (pointer: fine)");
  const target = (e: Event) => (e.target as Element).closest?.<HTMLElement>("[data-tip-item]") ?? null;
  root.addEventListener("pointerover", (e) => {
    const el = target(e);
    if (el && e.pointerType === "mouse" && mouse.matches && owner !== el) showTip(el, false, opts());
  });
  root.addEventListener("pointerout", (e) => {
    const el = target(e);
    if (el && tip?.classList.contains("tip-float") && !el.contains(e.relatedTarget as Node)) closeTip();
  });
  root.addEventListener("focusin", (e) => {
    const el = target(e);
    if (el && mouse.matches && owner !== el) showTip(el, false, opts());
  });
  root.addEventListener("focusout", (e) => target(e) && tip?.classList.contains("tip-float") && closeTip());
  root.addEventListener("click", (e) => {
    const el = target(e);
    if (!el || mouse.matches) return;
    e.preventDefault();
    e.stopPropagation();
    if (owner === el && tip?.classList.contains("tip-sheet")) closeTip();
    else showTip(el, true, opts());
  }, true);
}
