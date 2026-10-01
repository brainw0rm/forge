// Gear sandbox: equip real items from the game client, total their stats, and run an
// editable formula sheet on top. Item stats, armor and weapon damage come from the client;
// the formulas are visible assumptions the user can change.

import { signed } from "../../shared/items";
import { adSlot, fillAds } from "../ads";
import { classColor, getItems, getMeta, iconUrl, QUALITY_COLOR, type Item } from "../data";
import { runSheet } from "../formula";
import { openModal } from "../modal";
import { copy, esc, setTitle } from "../ui";

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

type Archetype = "melee" | "agile" | "caster" | "hybrid";
const ARCHETYPE: Record<string, Archetype> = {
  warrior: "melee", rogue: "agile", hunter: "agile", mage: "caster", warlock: "caster", priest: "caster",
  paladin: "hybrid", shaman: "hybrid", druid: "hybrid",
};

/** Starting formula sheets. These are Classic Era rules of thumb, shown as editable assumptions. */
const PRESETS: Record<Archetype, string> = {
  melee: `# Totals: gear plus the base stats you entered
str = base_str + gear_str
agi = base_agi + gear_agi
sta = base_sta + gear_sta
armor = gear_armor + agi * 2
health = sta * 10
# Classic Era rules of thumb at level 60. Edit them if Forever differs.
attack_power = level * 3 - 20 + str * 2 + gear_ap
crit_pct = agi / 20 + gear_crit / 14   # 14 crit rating = 1% (e.g. Lionheart Helm: 28 = 2%)
hit_pct = gear_hit / 10                  # 10 hit rating = 1%
# White damage per second with the main-hand weapon
mh_avg = (mh_min + mh_max) / 2
white_dps = (mh_avg + attack_power / 14 * mh_speed) / max(mh_speed, 0.1)`,
  agile: `# Totals: gear plus the base stats you entered
str = base_str + gear_str
agi = base_agi + gear_agi
sta = base_sta + gear_sta
armor = gear_armor + agi * 2
health = sta * 10
# Classic Era rules of thumb at level 60. Edit them if Forever differs.
attack_power = level * 2 - 20 + str + agi + gear_ap
ranged_attack_power = level * 2 - 10 + agi * 2 + gear_ap + gear_rap
crit_pct = agi / 29 + gear_crit / 14   # rogues ~29 agility per 1% crit, hunters ~53
hit_pct = gear_hit / 10
mh_avg = (mh_min + mh_max) / 2
white_dps = (mh_avg + attack_power / 14 * mh_speed) / max(mh_speed, 0.1)`,
  caster: `# Totals: gear plus the base stats you entered
int = base_int + gear_int
spi = base_spi + gear_spi
sta = base_sta + gear_sta
health = sta * 10
mana = int * 15
# Classic Era rules of thumb at level 60. Edit them if Forever differs.
spell_power = gear_sp + gear_spelldmg
healing_power = gear_sp + gear_healing
spell_crit_pct = int / 59.5 + gear_crit / 14   # ~59.5 intellect per 1% (mage)
spell_hit_pct = gear_hit / 10
mp5 = gear_mp5`,
  hybrid: `# Totals: gear plus the base stats you entered
str = base_str + gear_str
agi = base_agi + gear_agi
sta = base_sta + gear_sta
int = base_int + gear_int
armor = gear_armor + agi * 2
health = sta * 10
mana = int * 15
# Classic Era rules of thumb at level 60. Edit them if Forever differs.
attack_power = level * 3 - 20 + str * 2 + gear_ap
crit_pct = agi / 20 + gear_crit / 14
spell_power = gear_sp + gear_spelldmg
healing_power = gear_sp + gear_healing
spell_crit_pct = int / 54 + gear_crit / 14
mh_avg = (mh_min + mh_max) / 2
white_dps = (mh_avg + attack_power / 14 * mh_speed) / max(mh_speed, 0.1)`,
};

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
};

export async function renderGear(root: HTMLElement, slugPart: string, params: URLSearchParams) {
  const meta = await getMeta();
  const slug = meta.classes.some((c) => c.slug === slugPart) ? slugPart : meta.classes[0].slug;
  const clsName = meta.classes.find((c) => c.slug === slug)!.name;
  setTitle(`${clsName} gear sandbox`, "Try World of Warcraft: Forever items from the game client and see your totals.");

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
  const base: Record<string, number> = JSON.parse(store.get(`base:${slug}`) ?? "{}");
  let sheet = store.get(`sheet:${slug}`) ?? PRESETS[ARCHETYPE[slug]];

  root.innerHTML = `
    <section class="page gear" style="--class:${classColor(slug)}">
      <header class="page-head">
        <div>
          <h1>Gear sandbox</h1>
          <p class="lede">Equip items straight from the game client. Stats, armor and weapon damage come from the game data;
            the formulas underneath are yours to edit. The client contains every item it knows about, so not all of them
            are necessarily obtainable in Forever.</p>
        </div>
        <div class="build-head-actions">
          <button class="btn" id="share">Copy link</button>
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
          <section class="panel"><h2>Gear totals</h2><dl class="totals" id="totals"></dl></section>
        </div>
      </div>
      <section class="panel formula-panel">
        <div class="formula-head">
          <h2>Formula sheet</h2>
          <button class="btn small ghost" id="reset-sheet">Reset to ${ARCHETYPE[slug]} preset</button>
        </div>
        <p class="muted small">One <code>name = formula</code> per line, evaluated top to bottom. Available names:
          <code>gear_*</code> (${STAT_KEYS.slice(0, 8).join(", ")}, …), <code>base_*</code>, <code>level</code>,
          <code>mh_min</code>/<code>mh_max</code>/<code>mh_speed</code>/<code>mh_dps</code> (also <code>oh_</code>, <code>ranged_</code>),
          and <code>min max floor ceil round abs</code>. The presets are Classic Era rules of thumb, not confirmed Forever mechanics.</p>
        <div class="formula">
          <textarea id="sheet" spellcheck="false" aria-label="Formula sheet">${esc(sheet)}</textarea>
          <ol class="formula-results" id="results" aria-live="polite"></ol>
        </div>
      </section>
      ${adSlot("leaderboard")}
    </section>`;

  const totals = () => {
    const t: Record<string, number> = Object.fromEntries(STAT_KEYS.map((k) => [k, 0]));
    for (const item of equipped.values()) {
      for (const [k, v] of Object.entries(item.stats)) t[k] = (t[k] ?? 0) + v;
      if (item.armor) t.armor += item.armor;
    }
    return t;
  };

  const inputs = () => {
    const t = totals();
    const vars: Record<string, number> = { level: base.level ?? 60 };
    for (const k of STAT_KEYS) vars[`gear_${k}`] = t[k] ?? 0;
    for (const k of BASE_KEYS) vars[`base_${k}`] = base[k] ?? 0;
    for (const [prefix, key] of [["mh", "mh"], ["oh", "oh"], ["ranged", "ranged"]] as const) {
      const d = equipped.get(key)?.dmg;
      vars[`${prefix}_min`] = d?.min ?? 0;
      vars[`${prefix}_max`] = d?.max ?? 0;
      vars[`${prefix}_speed`] = d?.speed ?? 0;
      vars[`${prefix}_dps`] = d?.dps ?? 0;
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
    if (mh) rows.push(`<div><dt>Main hand</dt><dd>${mh.min}–${mh.max} · ${mh.speed.toFixed(2)} · ${mh.dps} DPS</dd></div>`);
    root.querySelector("#totals")!.innerHTML = rows.join("") || `<p class="muted small">Equip items to see totals.</p>`;
  };

  const drawSheet = () => {
    const { lines } = runSheet(sheet, inputs());
    root.querySelector("#results")!.innerHTML = lines
      .map((l) =>
        l.name
          ? `<li class="${l.error ? "err" : ""}" style="--line:${l.line}"><b>${esc(l.name)}</b> ${
              l.error ? `<span>${esc(l.error)}</span>` : `<span>${fmt(l.value!)}</span>`
            }</li>`
          : "",
      )
      .join("");
  };

  const update = () => {
    const qs = [...equipped].map(([k, i]) => `${k}:${i.id}`).join(",");
    history.replaceState(null, "", `/gear/${slug}${qs ? `?i=${qs}` : ""}`);
    drawSlots();
    drawTotals();
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
  textarea.addEventListener("input", () => {
    sheet = textarea.value;
    store.set(`sheet:${slug}`, sheet);
    drawSheet();
  });
  root.querySelector("#reset-sheet")!.addEventListener("click", () => {
    sheet = PRESETS[ARCHETYPE[slug]];
    textarea.value = sheet;
    store.set(`sheet:${slug}`, sheet);
    drawSheet();
  });
  root.querySelector("#clear")!.addEventListener("click", () => {
    equipped.clear();
    update();
  });
  root.querySelector("#share")!.addEventListener("click", () => copy(location.href, "Link copied"));
  update();
  fillAds(root);
}

const fmt = (v: number) => (Math.abs(v) >= 100 || Number.isInteger(v) ? Math.round(v).toLocaleString() : v.toFixed(2));

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
