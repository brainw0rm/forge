// The gear sandbox's character sheet: which stats each class sees, how they're calculated, and
// the rules of thumb behind them. The math runs through the formula sheet (src/formula.ts), so
// players who want to can still rewrite it line by line.

import { runSheet } from "./formula";

export type Group = "Attributes" | "Defense" | "Melee" | "Ranged" | "Spell";

export interface Param {
  key: string;
  label: string;
  value: number;
  note?: string;
}

export interface Stat {
  key: string;
  label: string;
  group: Group;
  formula: string;
  unit?: "%" | "dps";
  /** Plain-words version of the formula; {name} is replaced by that rule of thumb's value. */
  how?: string;
  /** Only meaningful with a weapon in this slot. */
  needs?: "mh" | "ranged";
}

const p = (key: string, label: string, value: number, note?: string): Param => ({ key, label, value, note });

const attr = (k: string, label: string): Stat => ({ key: k, label, group: "Attributes", formula: `base_${k} + gear_${k}` });
const HEALTH: Stat = { key: "health", label: "Health from Stamina", group: "Defense", formula: "sta * health_per_sta", how: "{health_per_sta} per Stamina" };
const ARMOR: Stat = { key: "armor", label: "Armor", group: "Defense", formula: "gear_armor + agi * armor_per_agi", how: "Gear armor plus {armor_per_agi} per Agility" };
const MANA: Stat = { key: "mana", label: "Mana from Intellect", group: "Spell", formula: "int * mana_per_int", how: "{mana_per_int} per Intellect" };
const HIT: Stat = { key: "hit_pct", label: "Hit chance from gear", group: "Melee", unit: "%", formula: "gear_hit / rating_per_hit + bonus_hit_pct", how: "{rating_per_hit} hit rating = 1%, plus set bonuses" };
const WHITE: Stat = {
  key: "white_dps", label: "Main-hand DPS", group: "Melee", unit: "dps", needs: "mh",
  formula: "((mh_min + mh_max) / 2 + attack_power / 14 * mh_speed) / max(mh_speed, 0.1)",
  how: "Weapon damage plus attack power ÷ 14 per second",
};
const SPELL: Stat[] = [
  { key: "spell_power", label: "Spell damage", group: "Spell", formula: "gear_sp + gear_spelldmg", how: "From gear" },
  { key: "healing_power", label: "Healing", group: "Spell", formula: "gear_sp + gear_healing", how: "From gear" },
  { key: "spell_crit_pct", label: "Spell crit chance", group: "Spell", unit: "%", formula: "int / int_per_spell_crit + gear_crit / rating_per_crit + bonus_spell_crit_pct", how: "{int_per_spell_crit} Intellect or {rating_per_crit} crit rating = 1%" },
  { key: "spell_hit_pct", label: "Spell hit from gear", group: "Spell", unit: "%", formula: "gear_hit / rating_per_hit + bonus_spell_hit_pct", how: "{rating_per_hit} hit rating = 1%, plus set bonuses" },
  { key: "mp5", label: "Mana per 5 sec", group: "Spell", formula: "gear_mp5", how: "From gear" },
];

const COMMON = [
  p("health_per_sta", "Health per Stamina", 10),
  p("rating_per_crit", "Crit rating per 1% crit", 14, "Lionheart Helm's 28 crit rating = 2%"),
  p("rating_per_hit", "Hit rating per 1% hit", 10),
];

interface Archetype {
  params: Param[];
  stats: Stat[];
}

const melee = (agiPerCrit: number, note: string): Archetype => ({
  params: [p("ap_per_str", "Attack power per Strength", 2), p("agi_per_crit", "Agility per 1% crit", agiPerCrit, note), p("armor_per_agi", "Armor per Agility", 2), ...COMMON],
  stats: [
    attr("str", "Strength"), attr("agi", "Agility"), attr("sta", "Stamina"),
    HEALTH, ARMOR,
    { key: "attack_power", label: "Attack power", group: "Melee", formula: "level * 3 - 20 + str * ap_per_str + gear_ap", how: "Level × 3 − 20, plus {ap_per_str} per Strength and gear" },
    { key: "crit_pct", label: "Crit chance from stats", group: "Melee", unit: "%", formula: "agi / agi_per_crit + gear_crit / rating_per_crit + bonus_crit_pct", how: "{agi_per_crit} Agility or {rating_per_crit} crit rating = 1%" },
    HIT, WHITE,
  ],
});

const agile = (agiPerCrit: number, note: string, ranged: boolean): Archetype => ({
  params: [p("agi_per_crit", "Agility per 1% crit", agiPerCrit, note), p("armor_per_agi", "Armor per Agility", 2), ...COMMON],
  stats: [
    attr("str", "Strength"), attr("agi", "Agility"), attr("sta", "Stamina"),
    HEALTH, ARMOR,
    { key: "attack_power", label: "Attack power", group: "Melee", formula: "level * 2 - 20 + str + agi + gear_ap", how: "Level × 2 − 20, plus 1 per Strength and Agility, plus gear" },
    { key: "crit_pct", label: "Crit chance from stats", group: "Melee", unit: "%", formula: "agi / agi_per_crit + gear_crit / rating_per_crit + bonus_crit_pct", how: "{agi_per_crit} Agility or {rating_per_crit} crit rating = 1%" },
    HIT, WHITE,
    ...(ranged
      ? [{
          key: "ranged_attack_power", label: "Ranged attack power", group: "Ranged" as const,
          formula: "level * 2 - 10 + agi * 2 + gear_ap + gear_rap", how: "Level × 2 − 10, plus 2 per Agility, plus gear",
        }]
      : []),
  ],
});

const caster = (intPerCrit: number, note: string): Archetype => ({
  params: [p("mana_per_int", "Mana per Intellect", 15), p("int_per_spell_crit", "Intellect per 1% spell crit", intPerCrit, note), ...COMMON],
  stats: [attr("int", "Intellect"), attr("spi", "Spirit"), attr("sta", "Stamina"), HEALTH, MANA, ...SPELL],
});

const hybrid = (intPerCrit: number): Archetype => ({
  params: [
    p("ap_per_str", "Attack power per Strength", 2), p("agi_per_crit", "Agility per 1% crit", 20), p("armor_per_agi", "Armor per Agility", 2),
    p("mana_per_int", "Mana per Intellect", 15), p("int_per_spell_crit", "Intellect per 1% spell crit", intPerCrit), ...COMMON,
  ],
  stats: [
    attr("str", "Strength"), attr("agi", "Agility"), attr("sta", "Stamina"), attr("int", "Intellect"),
    HEALTH, ARMOR,
    { key: "attack_power", label: "Attack power", group: "Melee", formula: "level * 3 - 20 + str * ap_per_str + gear_ap", how: "Level × 3 − 20, plus {ap_per_str} per Strength and gear" },
    { key: "crit_pct", label: "Crit chance from stats", group: "Melee", unit: "%", formula: "agi / agi_per_crit + gear_crit / rating_per_crit + bonus_crit_pct", how: "{agi_per_crit} Agility or {rating_per_crit} crit rating = 1%" },
    WHITE, MANA, ...SPELL.filter((s) => s.key !== "spell_hit_pct"),
  ],
});

/** Classic Era rules of thumb at level 60, per class. Forever may differ; players can change them. */
export const CLASS_SHEETS: Record<string, Archetype> = {
  warrior: melee(20, "Classic Era warrior at 60"),
  rogue: agile(29, "Classic Era rogue at 60", false),
  hunter: agile(53, "Classic Era hunter at 60", true),
  mage: caster(59.5, "Classic Era mage at 60"),
  warlock: caster(60.6, "Classic Era warlock at 60"),
  priest: caster(59.2, "Classic Era priest at 60"),
  paladin: hybrid(54),
  shaman: hybrid(59.2),
  druid: hybrid(60),
};

/** The formula sheet a set of rules of thumb produces: what "Edit the formulas yourself" starts from. */
export function sheetFor(cls: string, values: Record<string, number>): string {
  const a = CLASS_SHEETS[cls];
  return [
    "# Rules of thumb",
    ...a.params.map((x) => `${x.key} = ${values[x.key] ?? x.value}`),
    "# Character sheet",
    ...a.stats.map((s) => `${s.key} = ${s.formula}`),
  ].join("\n");
}

export interface SheetRow {
  key: string;
  label: string;
  value: number | null;
  unit?: "%" | "dps";
  how?: string;
  error?: string;
}

/** Run a sheet and arrange the results like a character pane. Names the sheet defines that aren't
 * standard stats (from edited formulas) come back under "Your formulas". */
export function characterSheet(cls: string, sheet: string, inputs: Record<string, number>) {
  const a = CLASS_SHEETS[cls];
  const { lines, vars } = runSheet(sheet, inputs);
  const errors = lines.filter((l) => l.error);
  const params = new Set(a.params.map((x) => x.key));
  const known = new Set(a.stats.map((s) => s.key));
  const groups = new Map<string, SheetRow[]>();
  const add = (g: string, row: SheetRow) => groups.set(g, [...(groups.get(g) ?? []), row]);
  for (const s of a.stats) {
    const line = lines.find((l) => l.name === s.key);
    const missingWeapon = s.needs && !inputs[`${s.needs}_speed`];
    const weapon = s.needs === "mh" ? "main-hand" : "ranged";
    add(s.group, {
      key: s.key,
      label: s.label,
      unit: s.unit,
      value: missingWeapon || !line || line.error ? null : (vars[s.key] ?? null),
      how: missingWeapon
        ? inputs[`${s.needs}_equipped`] ? `The client has no damage data for this ${weapon} weapon` : `Equip a ${weapon} weapon`
        : s.how?.replace(/\{(\w+)\}/g, (_, k) => fmtNum(vars[k] ?? NaN)),
      error: line?.error,
    });
  }
  for (const l of lines) {
    if (l.name && !l.error && !known.has(l.name) && !params.has(l.name)) add("Your formulas", { key: l.name, label: l.name, value: l.value! });
  }
  return { groups, errors };
}

export const fmtNum = (v: number) => (Number.isNaN(v) ? "?" : Number.isInteger(v) ? v.toLocaleString() : String(+v.toFixed(2)));

export function fmtStat(row: SheetRow) {
  if (row.value === null) return "–";
  if (row.unit === "%") return `${row.value.toFixed(2)}%`;
  if (row.unit === "dps") return row.value.toFixed(1);
  return Math.abs(row.value) >= 100 || Number.isInteger(row.value) ? Math.round(row.value).toLocaleString() : row.value.toFixed(2);
}
