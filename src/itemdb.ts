// Item database: types and loaders for public/data/items/db (see pipeline/itemdb.py).

import { load } from "./data";

export interface ItemRef {
  id: number;
  name: string;
  q: number;
  icon: string;
}

export interface ItemSpell {
  on: "use" | "equip" | "hit";
  text: string;
  spell: number;
  charges?: number;
  /** Cooldown in seconds. */
  cd?: number;
}

export interface Damage {
  min: number;
  max: number;
  speed: number;
  dps: number;
  /** Extra elemental damage line (Classic Era data only). */
  bonus?: { min: number; max: number; school: string };
}

export interface RecipeRef {
  spell: number;
  name: string;
  prof: string;
  profName: string;
  makes?: ItemRef;
}

export interface ItemNumbers {
  q: number;
  ilvl: number;
  req: number;
  stats: Record<string, number>;
  armor?: number;
  /** null: a weapon whose damage the client data doesn't let us derive. */
  dmg?: Damage | null;
}

export interface ItemDetail extends ItemNumbers {
  id: number;
  name: string;
  icon: string;
  cls: number;
  sub: number;
  slot: number;
  spells?: ItemSpell[];
  /** Forever-only stat types: named without a trustworthy value, or not identified yet. */
  other?: ({ label: string } | { type: number })[];
  bind?: number;
  unique?: true;
  stack?: number;
  bag?: number;
  /** Copper. */
  sell?: number;
  flavor?: string;
  quest?: true;
  school?: string;
  skill?: { name: string; rank: number };
  rep?: { faction: string; standing: string };
  pvpRank?: number;
  classes?: string[];
  faction?: "Alliance" | "Horde";
  races?: string[];
  set?: { id: number; name: string; items: ItemRef[]; bonuses: { n: number; text: string }[] };
  createdBy?: RecipeRef[];
  reagentFor?: RecipeRef[];
  teaches?: ItemRef;
  status: "new" | "changed" | "same";
  changes?: ("name" | "q" | "ilvl" | "req" | "stats" | "armor" | "dmg" | "effects")[];
  /** The Classic Era item this was compared with, when its ID differs. */
  classicId?: number;
  classic?: ItemNumbers & { name: string; spells?: ItemSpell[] };
  /** Forever stats with stat-like equip effects folded in, as used for the comparison. */
  cmpStats?: Record<string, number>;
}

/** One search row; see `fields` in index.json. */
export interface ItemRow {
  id: number;
  name: string;
  q: number;
  ilvl: number;
  req: number;
  cls: number;
  sub: number;
  slot: number;
  icon: string;
  /** 0 same as Classic, 1 new in Forever, 2 changed. */
  flag: number;
  lower: string;
}

export interface ItemDbMeta {
  shards: number;
  classes: { id: number; name: string; count: number; subs: { id: number; name: string }[] }[];
}

interface RawIndex {
  build: string;
  classicBuild: string;
  icons: string[];
  rows: [number, string, number, number, number, number, number, number, number, number][];
}

let index: Promise<{ build: string; classicBuild: string; rows: ItemRow[] }> | null = null;

export function getItemIndex() {
  index ??= load<RawIndex>("items/db/index.json").then((raw) => ({
    build: raw.build,
    classicBuild: raw.classicBuild,
    rows: raw.rows.map(([id, name, q, ilvl, req, cls, sub, slot, icon, flag]) => ({
      id, name, q, ilvl, req, cls, sub, slot, icon: raw.icons[icon], flag, lower: name.toLowerCase(),
    })),
  }));
  return index;
}

export const getItemDbMeta = () => load<ItemDbMeta>("items/db/meta.json");

export async function getItem(id: number): Promise<ItemDetail | null> {
  const meta = await getItemDbMeta();
  const shard = await load<Record<string, ItemDetail>>(`items/db/d/${id % meta.shards}.json`);
  return shard[String(id)] ?? null;
}

export { PRIMARY_STATS, QUALITY_NAME, SLOT_NAME, STAT_NAME, statLine } from "../shared/items";

/** Gear sandbox slot for an item's inventory type (see src/views/gear.ts). */
export const GEAR_SLOT: Record<number, string> = {
  1: "head", 2: "neck", 3: "shoulder", 16: "back", 5: "chest", 20: "chest", 9: "wrist", 10: "hands", 6: "waist",
  7: "legs", 8: "feet", 11: "finger1", 12: "trinket1", 13: "mh", 17: "mh", 21: "mh", 22: "oh", 14: "oh", 23: "oh",
  15: "ranged", 25: "ranged", 26: "ranged", 28: "ranged",
};

export const BIND_TEXT: Record<number, string> = {
  1: "Binds when picked up", 2: "Binds when equipped", 3: "Binds when used", 4: "Quest Item", 5: "Quest Item",
};

/** 255355 copper -> [25, 53, 55] (gold, silver, copper). */
export const coins = (copper: number) => [Math.floor(copper / 10000), Math.floor(copper / 100) % 100, copper % 100];
