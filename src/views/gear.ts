// Gear sandbox: equip real items from the game client, total their stats, and run an
// editable formula sheet on top. Item stats, armor and weapon damage come from the client;
// the character sheet's rules of thumb are visible assumptions the user can change (src/gearstats.ts).

import { signed } from "../../shared/items";
import { adSlot, fillAds } from "../ads";
import { classColor, getItems, getMeta, iconUrl, QUALITY_COLOR, type Item } from "../data";
import { CLASS_SHEETS, characterSheet, fmtStat, sheetFor } from "../gearstats";
import { openModal } from "../modal";
import { parseBonus } from "../setbonus";
import { openShare } from "../share";
import { getSets, type ItemSet } from "./sets";
import { esc, setTitle } from "../ui";

interface Slot {
  key: string;
  label: string;
  types: number[];
}

const SLOTS: Slot[] = [
  { key: "head", label: "Head", types: [1] },
  { key: "neck", label: "Neck", types: [2] },
  { key: "shoulder", label: "Shoulders", types: [3] },
  { key: "back", label: "Back", types: [16] },
  { key: "chest", label: "Chest", types: [5, 20] },
  { key: "wrist", label: "Wrists", types: [9] },
  { key: "hands", label: "Hands", types: [10] },
  { key: "waist", label: "Waist", types: [6] },
  { key: "legs", label: "Legs", types: [7] },
  { key: "feet", label: "Feet", types: [8] },
  { key: "finger1", label: "Finger", types: [11] },
  { key: "finger2", label: "Finger", types: [11] },
  { key: "trinket1", label: "Trinket", types: [12] },
  { key: "trinket2", label: "Trinket", types: [12] },
  { key: "mh", label: "Main hand", types: [13, 17, 21] },
  { key: "oh", label: "Off hand", types: [13, 22, 14, 23] },
  { key: "ranged", label: "Ranged / relic", types: [15, 25, 26, 28] },
];

const STAT_LABEL: Record<string, string> = {
  str: "Strength", agi: "Agility", sta: "Stamina", int: "Intellect", spi: "Spirit", armor: "Armor",
  ap: "Attack power", rap: "Ranged attack power", crit: "Crit rating", hit: "Hit rating", haste: "Haste rating",
  sp: "Spell power", spelldmg: "Spell damage", healing: "Healing", mp5: "Mana per 5 sec", hp5: "Health per 5 sec",
  defense: "Defense rating", dodge: "Dodge rating", parry: "Parry rating", block: "Block rating", blockvalue: "Block value",
  spellpen: "Spell penetration", mana: "Mana", health: "Health",
  fireres: "Fire resistance", frostres: "Frost resistance", natureres: "Nature resistance",
  shadowres: "Shadow resistance", arcaneres: "Arcane resistance", holyres: "Holy resistance",
};
const STAT_KEYS = Object.keys(STAT_LABEL);
const BASE_KEYS = ["str", "agi", "sta", "int", "spi"] as const;
const ARMOR_NAMES = ["", "Cloth", "Leather", "Mail", "Plate"];

const store = {
  get(key: string) {
    try {
      return localStorage.getItem(`ff:gear:${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(`ff:gear:${key}`, value);
    } catch {
      /* private mode */
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(`ff:gear:${key}`);
    } catch {
      /* private mode */
    }
  },
};

export async function renderGear(root: HTMLElement, slugPart: string, params: URLSearchParams) {
  const meta = await getMeta();
  const slug = meta.classes.some((c) => c.slug === slugPart) ? slugPart : meta.classes[0].slug;
  const clsName = meta.classes.find((c) => c.slug === slug)!.name;
  setTitle(`${clsName} Gear Sandbox for WoW Forever`, "Try World of Warcraft: Forever items from the game client and see your totals.");

  // Equipped items from the URL: ?i=head:12640,mh:12784
  const equipped = new Map<string, Item>();
  const wanted = (params.get("i") ?? "")
    .split(",")
    .map((p) => p.split(":"))
    .filter(([k, v]) => SLOTS.some((s) => s.key === k) && /^\d+$/.test(v ?? ""));
  await Promise.all(
    wanted.map(async ([key, id]) => {
      const slot = SLOTS.find((s) => s.key === key)!;
      const lists = await Promise.all(slot.types.map((t) => getItems(t).catch(() => [] as Item[])));
      const item = lists.flat().find((i) => i.id === Number(id));
      if (item) equipped.set(key, item);
    }),
  );
  const setsById = new Map((await getSets()).sets.map((s) => [s.id, s]));
  const base: Record<string, number> = JSON.parse(store.get(`base:${slug}`) ?? "{}");
  const rules = CLASS_SHEETS[slug];
  const ruleValues: Record<string, number> = { ...Object.fromEntries(rules.params.map((x) => [x.key, x.value])), ...JSON.parse(store.get(`rules:${slug}`) ?? "{}") };
  // Formulas the player rewrote by hand; null while the rules of thumb drive the sheet.
  let custom = store.get(`formulas:${slug}`);
  const sheet = () => custom ?? sheetFor(slug, ruleValues);

  root.innerHTML = `
    <section class="page gear" style="--class:${classColor(slug)}">
      <header class="page-head">
        <div>
          <h1>Gear sandbox</h1>
          <p class="lede">Put on real items from the game client and see your character sheet add up. The math uses Classic Era
            rules of thumb, which you can change. Heads up: the client has plenty of items that may never be obtainable in Forever.</p>
        </div>
        <div class="build-head-actions">
          <button class="btn" id="share">Share</button>
          <button class="btn ghost" id="clear">Unequip all</button>
        </div>
      </header>
      <nav class="class-tabs">
        ${meta.classes.map((c) => `<a href="/gear/${c.slug}" data-link class="${c.slug === slug ? "active" : ""}" style="--c:${classColor(c.slug)}">${esc(c.name)}</a>`).join("")}
      </nav>
      <div class="gear-layout">
        <div class="gear-slots" id="slots"></div>
        <div class="gear-side">
          <section class="panel">
            <h2>Base stats</h2>
            <p class="muted small">From your character sheet without gear. The client doesn't include base stats per race and class.</p>
            <div class="base-grid">
              ${BASE_KEYS.map((k) => `<label>${STAT_LABEL[k]}<input type="number" min="0" max="1000" data-base="${k}" value="${base[k] ?? 0}" /></label>`).join("")}
              <label>Level<input type="number" min="1" max="60" data-base="level" value="${base.level ?? 60}" /></label>
            </div>
          </section>
          <section class="panel"><h2>Character sheet</h2><div class="char-sheet" id="char-sheet" aria-live="polite"></div></section>
          <section class="panel"><h2>From your gear</h2><dl class="totals" id="totals"></dl></section>
          <section class="panel" id="set-panel" hidden><h2>Set bonuses</h2><div class="gear-sets" id="gear-sets"></div></section>
        </div>
      </div>
      <section class="panel rules-panel">
        <div class="formula-head">
          <h2>Rules of thumb</h2>
          <button class="btn small ghost" id="reset-rules">Reset</button>
        </div>
        <p class="muted small">The character sheet uses these Classic Era values for a level 60 ${esc(clsName.toLowerCase())}. Forever may work differently: if you know better, change them here.</p>
        <p class="rules-custom" id="rules-custom" hidden>You're using your own formulas, so these don't apply. <button type="button" class="link-btn" id="drop-custom">Go back to the rules of thumb</button></p>
        <div class="rules-grid" id="rules">
          ${rules.params
            .map((x) => `<label><span>${esc(x.label)}</span><input type="number" step="any" min="0" data-rule="${x.key}" value="${ruleValues[x.key]}" />${x.note ? `<small>${esc(x.note)}</small>` : ""}</label>`)
            .join("")}
        </div>
        <details class="formula-details" id="formula-details">
          <summary>Edit the formulas yourself</summary>
          <p class="muted small">One <code>name = formula</code> per line, top to bottom; each line can use the ones above it. You can also use
            <code>gear_*</code> (${STAT_KEYS.slice(0, 8).join(", ")}, …), <code>base_*</code>, <code>level</code>,
            <code>mh_min</code>/<code>mh_max</code>/<code>mh_speed</code>/<code>mh_dps</code> (also <code>oh_</code>, <code>ranged_</code>)
            and <code>min max floor ceil round abs</code>. New names show up in the character sheet under "Your formulas".</p>
          <textarea id="sheet" spellcheck="false" aria-label="Formulas">${esc(sheet())}</textarea>
          <ul class="formula-errors" id="formula-errors" aria-live="polite"></ul>
        </details>
      </section>
      ${adSlot("leaderboard")}
    </section>`;

  /** Sets with at least one piece on, and how many different pieces (two of the same ring count once). */
  const activeSets = () => {
    const pieces = new Map<number, Set<number>>();
    for (const item of equipped.values()) if (item.set && setsById.has(item.set)) pieces.set(item.set, (pieces.get(item.set) ?? new Set()).add(item.id));
    return [...pieces].map(([id, ids]) => ({ set: setsById.get(id)! as ItemSet, count: ids.size }));
  };
  const setBonuses = () => {
    const stats: Record<string, number> = {};
    const pct = { hit: 0, crit: 0, spellHit: 0, spellCrit: 0 };
    for (const { set, count } of activeSets()) {
      for (const b of set.bonuses) {
        const e = b.n <= count ? parseBonus(b.text) : null;
        if (!e) continue;
        for (const [k, v] of Object.entries(e.stats)) stats[k] = (stats[k] ?? 0) + v;
        for (const [k, v] of Object.entries(e.pct)) pct[k as keyof typeof pct] += v ?? 0;
      }
    }
    return { stats, pct };
  };

  const totals = () => {
    const t: Record<string, number> = Object.fromEntries(STAT_KEYS.map((k) => [k, 0]));
    for (const item of equipped.values()) {
      for (const [k, v] of Object.entries(item.stats)) t[k] = (t[k] ?? 0) + v;
      if (item.armor) t.armor += item.armor;
    }
    for (const [k, v] of Object.entries(setBonuses().stats)) t[k] = (t[k] ?? 0) + v;
    return t;
  };

  const inputs = () => {
    const t = totals();
    const vars: Record<string, number> = { level: base.level ?? 60 };
    for (const k of STAT_KEYS) vars[`gear_${k}`] = t[k] ?? 0;
    for (const k of BASE_KEYS) vars[`base_${k}`] = base[k] ?? 0;
    const { pct } = setBonuses();
    Object.assign(vars, { bonus_hit_pct: pct.hit, bonus_crit_pct: pct.crit, bonus_spell_hit_pct: pct.spellHit, bonus_spell_crit_pct: pct.spellCrit });
    for (const [prefix, key] of [["mh", "mh"], ["oh", "oh"], ["ranged", "ranged"]] as const) {
      const d = equipped.get(key)?.dmg;
      vars[`${prefix}_min`] = d?.min ?? 0;
      vars[`${prefix}_max`] = d?.max ?? 0;
      vars[`${prefix}_speed`] = d?.speed ?? 0;
      vars[`${prefix}_dps`] = d?.dps ?? 0;
      vars[`${prefix}_equipped`] = equipped.has(key) ? 1 : 0;
    }
    return vars;
  };

  const drawSlots = () => {
    root.querySelector("#slots")!.innerHTML = SLOTS.map((s) => {
      const item = equipped.get(s.key);
      return `<button class="gear-slot ${item ? "filled" : ""}" data-slot="${s.key}">
          ${item ? `<img src="${iconUrl(item.icon)}" alt="" />` : `<span class="slot-empty"></span>`}
          <span class="slot-text"><small>${esc(s.label)}</small>
            ${item ? `<b style="color:${QUALITY_COLOR[item.q]}">${esc(item.name)}</b><span class="muted small">${statLine(item)}</span>` : `<span class="muted">Empty</span>`}
          </span>
          ${item ? `<span class="slot-remove" data-remove="${s.key}" title="Unequip" role="button" aria-label="Unequip ${esc(s.label)}">✕</span>` : ""}
        </button>`;
    }).join("");
    root.querySelectorAll<HTMLElement>("[data-slot]").forEach((el) =>
      el.addEventListener("click", (e) => {
        const remove = (e.target as HTMLElement).closest<HTMLElement>("[data-remove]");
        if (remove) {
          equipped.delete(remove.dataset.remove!);
          update();
          return;
        }
        pickItem(SLOTS.find((s) => s.key === el.dataset.slot)!, base.level ?? 60, (item) => {
          equipped.set(el.dataset.slot!, item);
          update();
        });
      }),
    );
  };

  const drawTotals = () => {
    const t = totals();
    const rows = STAT_KEYS.filter((k) => t[k]).map((k) => `<div><dt>${esc(STAT_LABEL[k])}</dt><dd>${t[k]}</dd></div>`);
    const mh = equipped.get("mh")?.dmg;
    if (mh) rows.push(`<div class="wide"><dt>Main hand</dt><dd>${mh.min}–${mh.max} · ${mh.speed.toFixed(2)} · ${mh.dps} DPS</dd></div>`);
    root.querySelector("#totals")!.innerHTML = rows.join("") || `<p class="muted small">Equip items to see totals.</p>`;
  };

  const drawSheet = () => {
    const { groups, errors } = characterSheet(slug, sheet(), inputs());
    root.querySelector("#char-sheet")!.innerHTML = [...groups.entries()]
      .map(
        ([group, rows]) => `<h3>${esc(group)}</h3><dl>${rows
          .map(
            (r) => `<div class="${r.error ? "err" : ""}"><dt>${esc(r.label)}${r.how && !r.error ? `<small>${esc(r.how)}</small>` : ""}${
              r.error ? `<small>${esc(r.error)}</small>` : ""
            }</dt><dd>${fmtStat(r)}</dd></div>`,
          )
          .join("")}</dl>`,
      )
      .join("");
    root.querySelector("#formula-errors")!.innerHTML = errors.map((e) => `<li>Line ${e.line}: ${esc(e.error!)}</li>`).join("");
    root.querySelector<HTMLElement>("#rules-custom")!.hidden = custom === null;
    root.querySelectorAll<HTMLInputElement>("[data-rule]").forEach((i) => (i.disabled = custom !== null));
  };

  const drawSets = () => {
    const active = activeSets().filter((a) => a.set.bonuses.length);
    root.querySelector<HTMLElement>("#set-panel")!.hidden = !active.length;
    root.querySelector("#gear-sets")!.innerHTML = active
      .map(
        ({ set, count }) => `<div class="gear-set">
          <a href="/sets/${set.id}" data-link><b>${esc(set.name)}</b></a> <span class="muted small">${count}/${set.items.length} pieces</span>
          <ul>${set.bonuses
            .map((b) => {
              const on = b.n <= count;
              const counted = on && parseBonus(b.text);
              return `<li class="${on ? "on" : ""}"><span>(${b.n})</span> ${esc(b.text)}${on && !counted ? ` <small>not in the numbers</small>` : ""}</li>`;
            })
            .join("")}</ul>
        </div>`,
      )
      .join("");
  };

  const update = () => {
    const qs = [...equipped].map(([k, i]) => `${k}:${i.id}`).join(",");
    history.replaceState(null, "", `/gear/${slug}${qs ? `?i=${qs}` : ""}`);
    drawSlots();
    drawTotals();
    drawSets();
    drawSheet();
  };

  root.querySelectorAll<HTMLInputElement>("[data-base]").forEach((input) =>
    input.addEventListener("input", () => {
      base[input.dataset.base!] = Math.max(0, Number(input.value) || 0);
      store.set(`base:${slug}`, JSON.stringify(base));
      drawSheet();
    }),
  );
  const textarea = root.querySelector<HTMLTextAreaElement>("#sheet")!;
  const saveRules = () => store.set(`rules:${slug}`, JSON.stringify(ruleValues));
  const saveCustom = () => (custom === null ? store.remove(`formulas:${slug}`) : store.set(`formulas:${slug}`, custom));
  root.querySelectorAll<HTMLInputElement>("[data-rule]").forEach((input) =>
    input.addEventListener("input", () => {
      const v = Number(input.value);
      if (!(v > 0)) return; // ignore blanks and zeros while typing; they'd divide by zero
      ruleValues[input.dataset.rule!] = v;
      saveRules();
      textarea.value = sheet();
      drawSheet();
    }),
  );
  textarea.addEventListener("input", () => {
    // Editing the text makes it the player's own; matching the generated sheet again undoes that.
    custom = textarea.value === sheetFor(slug, ruleValues) ? null : textarea.value;
    saveCustom();
    drawSheet();
  });
  const resetRules = () => {
    custom = null;
    saveCustom();
    for (const x of rules.params) ruleValues[x.key] = x.value;
    saveRules();
    root.querySelectorAll<HTMLInputElement>("[data-rule]").forEach((i) => (i.value = String(ruleValues[i.dataset.rule!])));
    textarea.value = sheet();
    drawSheet();
  };
  root.querySelector("#reset-rules")!.addEventListener("click", resetRules);
  root.querySelector("#drop-custom")!.addEventListener("click", () => {
    custom = null;
    saveCustom();
    textarea.value = sheet();
    drawSheet();
  });
  if (custom !== null) root.querySelector<HTMLDetailsElement>("#formula-details")!.open = true;
  root.querySelector("#clear")!.addEventListener("click", () => {
    equipped.clear();
    update();
  });
  root.querySelector("#share")!.addEventListener("click", () =>
    openShare({ url: location.href, text: `My ${clsName} gear setup for WoW Forever` }),
  );
  update();
  fillAds(root);
}

function statLine(item: Item) {
  const parts = Object.entries(item.stats)
    .slice(0, 4)
    .map(([k, v]) => `${signed(v)} ${STAT_LABEL[k]?.replace(/ rating$/, "") ?? k}`);
  if (item.armor) parts.unshift(`${item.armor} armor`);
  if (item.dmg) parts.unshift(`${item.dmg.dps} DPS`);
  return esc(parts.join(" · "));
}

function pickItem(slot: Slot, level: number, onPick: (item: Item) => void) {
  const dlg = openModal(
    `Choose ${slot.label.toLowerCase()}`,
    `<div class="picker">
      <div class="filter-row">
        <input type="search" name="q" placeholder="Search items" autofocus aria-label="Search items" />
        <select name="armor" aria-label="Armor type">
          <option value="">Any type</option>
          ${ARMOR_NAMES.slice(1).map((n, i) => `<option value="${i + 1}">${n}</option>`).join("")}
        </select>
      </div>
      <label class="check-pill"><input type="checkbox" name="usable" checked /> Level ${level} or lower</label>
      <label class="check-pill"><input type="checkbox" name="new" /> New in Forever</label>
      <ul class="picker-list" id="picker-list"><li class="muted">Loading items…</li></ul>
    </div>`,
  );
  dlg.classList.add("wide");
  Promise.all(slot.types.map((t) => getItems(t).catch(() => [] as Item[]))).then((lists) => {
    const items = lists.flat().sort((a, b) => b.ilvl - a.ilvl || a.name.localeCompare(b.name));
    const form = dlg.querySelector<HTMLElement>(".picker")!;
    const draw = () => {
      const q = (form.querySelector<HTMLInputElement>("[name=q]")!.value || "").toLowerCase();
      const armor = Number(form.querySelector<HTMLSelectElement>("[name=armor]")!.value);
      const usable = form.querySelector<HTMLInputElement>("[name=usable]")!.checked;
      const onlyNew = form.querySelector<HTMLInputElement>("[name=new]")!.checked;
      const shown = items
        .filter(
          (i) =>
            (!q || i.name.toLowerCase().includes(q)) &&
            (!armor || (i.cls === 4 && i.sub === armor)) &&
            (!usable || i.req <= level) &&
            (!onlyNew || i.new),
        )
        .slice(0, 120);
      form.querySelector("#picker-list")!.innerHTML = shown.length
        ? shown
            .map(
              (i) => `<li><button type="button" data-id="${i.id}">
                <img src="${iconUrl(i.icon)}" alt="" loading="lazy" />
                <span><b style="color:${QUALITY_COLOR[i.q]}">${esc(i.name)}</b>${i.new ? ` <span class="tag tag-new">New</span>` : ""}
                  <small class="muted">ilvl ${i.ilvl} · req ${i.req}${i.cls === 4 && ARMOR_NAMES[i.sub] ? ` · ${ARMOR_NAMES[i.sub]}` : ""}</small>
                  <small>${statLine(i)}${i.dmg === null ? " · damage not in client data" : ""}</small></span>
              </button></li>`,
            )
            .join("")
        : `<li class="muted">No items match.</li>`;
      form.querySelectorAll<HTMLButtonElement>("[data-id]").forEach((b) =>
        b.addEventListener("click", () => {
          onPick(items.find((i) => i.id === Number(b.dataset.id))!);
          dlg.close();
        }),
      );
    };
    form.addEventListener("input", draw);
    draw();
  });
}
