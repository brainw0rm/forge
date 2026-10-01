// Types mirror the JSON written by pipeline/build_data.py.

/** vs Classic Era. "expanded": the Classic effect is kept and something is added. */
export type Status = "new" | "reworked" | "expanded" | "tuned" | "moved" | "unchanged" | "unverified";

export interface Talent {
  id: number;
  name: string;
  tier: number;
  col: number;
  /** Points required in lower tiers of this tree before it can be learned. */
  req?: number;
  /** Tooltip text per rank; "" when the rank's data isn't in the game client. */
  ranks: string[];
  spells: number[];
  prereq: { id: number; rank: number } | null;
  active: boolean;
  /** Index of the first rank that isn't straight from the Forever client. */
  estimated: number;
  source: "forever" | "classic" | "missing";
  icon: string;
  status: Status;
  notes?: string[];
  /** Hand-checked explanation of the classification (pipeline/classification-review.json). */
  reason?: string;
  classic?: { name: string; ranks: string[]; tier: number; col: number; tab: number };
}

export interface Tree {
  id: number;
  name: string;
  background: string;
  icon: string;
  talents: Talent[];
}

export interface ClassData {
  build: string;
  classicBuild: string;
  classId: number;
  slug: string;
  name: string;
  trees: Tree[];
  removed: { name: string; tree: string; tier: number; ranks: string[] }[];
}

export interface ClassSummary {
  id: number;
  slug: string;
  name: string;
  trees: { name: string; icon: string }[];
  counts: Record<Status, number>;
  removed: number;
}

export interface Meta {
  build: string;
  classicBuild: string;
  builds: string[];
  generated: string;
  classes: ClassSummary[];
  /** "beta" until a live Forever build exists on wago.tools; the pipeline switches automatically. */
  phase?: "beta" | "live";
}

/** WoW Forever's announced release date. */
export const RELEASE_DATE = new Date("2026-11-04T00:00:00Z");
export const isLive = (m: Meta) => m.phase === "live";
/** "beta client" before launch, "game client" after. */
export const clientLabel = (m: Meta) => (isLive(m) ? "game client" : "beta client");
/** "beta build 70094" before launch, "build 71000" after. */
export const buildLabel = (m: Meta, build: string | number) => `${isLive(m) ? "build" : "beta build"} ${String(build).split(".").pop()}`;

export interface Change {
  type: "added" | "removed" | "changed";
  kinds?: string[];
  talent: number;
  class: string;
  name: string;
  oldName?: string;
  before?: string;
  after?: string;
  beforeRanks?: number;
  afterRanks?: number;
  beforePos?: [number, number];
  afterPos?: [number, number];
}

export interface ChangelogEntry {
  build: string;
  previous: string;
  changes: Change[];
}

export interface Race {
  id: number;
  name: string;
  faction: "alliance" | "horde";
  lore: string;
  classes: { id: number; status: "new" | "classic" }[];
}

const cache = new Map<string, Promise<unknown>>();

export function load<T>(path: string): Promise<T> {
  let p = cache.get(path);
  if (!p) {
    p = fetch(`/data/${path}`).then((r) => {
      if (!r.ok) throw new Error(`Failed to load ${path}: ${r.status}`);
      return r.json();
    });
    cache.set(path, p);
  }
  return p as Promise<T>;
}

export const getMeta = () => load<Meta>("meta.json");
export const getClass = (slug: string) => load<ClassData>(`classes/${slug}.json`);
export const getChangelog = () => load<ChangelogEntry[]>("changelog.json");
export const getRaces = () => load<Race[]>("races.json");

/** The game's own class colors (what players recognize); keep in sync with server/og-route.ts. */
const CLASS_COLOR: Record<string, string> = {
  warrior: "#c69b6d",
  paladin: "#f48cba",
  hunter: "#aad372",
  rogue: "#fff468",
  priest: "#ffffff",
  shaman: "#0070dd",
  mage: "#3fc7eb",
  warlock: "#8788ee",
  druid: "#ff7c0a",
};
export const classColor = (slug: string) => CLASS_COLOR[slug] ?? "#f5e5cf";

// Blizzard's render CDN only serves 56px icons; CSS scales them down.
export const iconUrl = (icon: string) => `https://render.worldofwarcraft.com/us/icons/56/${icon}.jpg`;

/** "1.60.1.70094" -> 70094 */
export const buildNumber = (build: string) => Number(build.split(".").pop());

export const STATUS_LABEL: Record<Status, string> = {
  new: "New",
  reworked: "Reworked",
  expanded: "Expanded",
  tuned: "Tuned",
  moved: "Moved",
  unchanged: "Unchanged",
  unverified: "Unverified",
};

// ---------------------------------------------------------------- tools data

export interface Ability {
  level: number;
  name: string;
  rank: string;
  icon: string;
  passive: boolean;
  /** Trait node id of the talent that unlocks this ability chain. */
  talent?: number;
}

export interface Dungeon {
  name: string;
  minLevel: number;
  maxLevel?: number;
  kind: "dungeon" | "raid";
  source: "client" | "announced";
  isNew: boolean;
  size?: number;
  announced?: { min: number; max: number };
}

export interface LegacyOption {
  entry: number;
  name: string;
  ranks: string[];
  icon: string;
}

export interface LegacyNode {
  id: number;
  row: number;
  col: number;
  req: number;
  prereq: number | null;
  choice: boolean;
  placeholder?: boolean;
  options: LegacyOption[];
}

export interface LegacyData {
  cap: number;
  trees: { id: number; label: string; nodes: LegacyNode[] }[];
  sources: { requirement: string; amount: number; achievement: number }[];
}

export interface ItemRef {
  id: number;
  name: string;
  count: number;
  q: number;
  icon: string;
}

export interface Recipe {
  spell: number;
  name: string;
  skill: number;
  yellow: number;
  grey: number;
  creates: ItemRef | null;
  reagents: ItemRef[];
  new?: boolean;
}

export interface ProfessionSummary {
  id: number;
  slug: string;
  name: string;
  kind: "primary" | "secondary";
  icon: string;
  recipes: number;
  new: number;
}

export interface Item {
  id: number;
  name: string;
  q: number;
  ilvl: number;
  req: number;
  slot: number;
  cls: number;
  sub: number;
  icon: string;
  stats: Record<string, number>;
  armor?: number;
  /** null: a special weapon whose damage isn't derivable from the client tables. */
  dmg?: { min: number; max: number; speed: number; dps: number } | null;
  set?: number;
  new?: boolean;
}

export const getLeveling = (slug: string) => load<{ abilities: Ability[] }>(`leveling/${slug}.json`);
export const getDungeons = () => load<{ source: string; dungeons: Dungeon[] }>("dungeons.json");
export const getLegacy = () => load<LegacyData>("legacy.json");
export const getProfessions = () => load<ProfessionSummary[]>("professions/index.json");
export const getProfession = (slug: string) =>
  load<{ id: number; name: string; recipes: Recipe[] }>(`professions/${slug}.json`);
export const getItems = (slot: number) => load<Item[]>(`items/slot-${slot}.json`);

/** The game's item quality colors, poor..artifact. */
export const QUALITY_COLOR = ["#9d9d9d", "#ffffff", "#1eff00", "#0070dd", "#a335ee", "#ff8000", "#e6cc80"];
