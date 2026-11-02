// Turns set bonus texts into numbers for the gear sandbox. Only bonuses whose text says exactly
// what they add are counted; procs and ability tweaks are listed but left out of the numbers.

/** Flat stats use the gear stat keys (src/views/gear.ts STAT_LABEL); percentages are separate. */
export interface BonusEffect {
  stats: Record<string, number>;
  pct: { hit?: number; crit?: number; spellHit?: number; spellCrit?: number };
}

const FLAT: [RegExp, string][] = [
  [/^\+(\d+) Strength\.?$/i, "str"],
  [/^\+(\d+) Agility\.?$/i, "agi"],
  [/^\+(\d+) Stamina\.?$/i, "sta"],
  [/^\+(\d+) Intellect\.?$/i, "int"],
  [/^\+(\d+) Spirit\.?$/i, "spi"],
  [/^\+(\d+) Armor\.?$/i, "armor"],
  [/^\+(\d+) Attack Power\.?$/i, "ap"],
  [/^\+(\d+) Ranged Attack Power\.?$/i, "rap"],
  [/^\+(\d+) Fire Resistance\.?$/i, "fireres"],
  [/^\+(\d+) Frost Resistance\.?$/i, "frostres"],
  [/^\+(\d+) Nature Resistance\.?$/i, "natureres"],
  [/^\+(\d+) Shadow Resistance\.?$/i, "shadowres"],
  [/^\+(\d+) Arcane Resistance\.?$/i, "arcaneres"],
  [/^Restores (\d+) mana per 5 sec\.?$/i, "mp5"],
  [/^Increases damage and healing done by magical spells and effects by up to (\d+)\.?$/i, "sp"],
  [/^Increases healing done by spells and effects by up to (\d+)\.?$/i, "healing"],
];
const RESISTANCES = ["fireres", "frostres", "natureres", "shadowres", "arcaneres"];

export function parseBonus(text: string): BonusEffect | null {
  const t = text.trim();
  for (const [re, key] of FLAT) {
    const m = re.exec(t);
    if (m) return { stats: { [key]: Number(m[1]) }, pct: {} };
  }
  let m = /^\+(\d+) All Resistances\.?$/i.exec(t);
  if (m) return { stats: Object.fromEntries(RESISTANCES.map((k) => [k, Number(m![1])])), pct: {} };
  m = /^Increases healing done by up to (\d+) and damage done by up to (\d+) for all magical spells and effects\.?$/i.exec(t);
  if (m) return { stats: { healing: Number(m[1]), spelldmg: Number(m[2]) }, pct: {} };
  m = /^Improves your chance to hit( with spells)? by ([\d.]+)%\.?$/i.exec(t);
  if (m) return { stats: {}, pct: m[1] ? { spellHit: Number(m[2]) } : { hit: Number(m[2]) } };
  m = /^Improves your chance to get a critical strike( with spells| with melee attacks)? by ([\d.]+)%\.?$/i.exec(t);
  if (m) return { stats: {}, pct: /spells/i.test(m[1] ?? "") ? { spellCrit: Number(m[2]) } : { crit: Number(m[2]) } };
  return null;
}
