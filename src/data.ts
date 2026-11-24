// Types mirror the JSON written by pipeline/build_data.py (meta) and pipeline/extras.py (professions).

export interface ClassSummary {
  id: number;
  slug: string;
  name: string;
}

export interface Meta {
  build: string;
  classicBuild: string;
  builds: string[];
  generated: string;
  /** Class names for item tooltips ("Classes: Mage"). */
  classes: ClassSummary[];
  /** "beta" until a live Forever build exists on wago.tools; the pipeline switches automatically. */
  phase?: "beta" | "live";
}

export const isLive = (m: Meta) => m.phase === "live";
/** "beta client" before launch, "game client" after. */
export const clientLabel = (m: Meta) => (isLive(m) ? "game client" : "beta client");

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

/** The game's own class colors (what players recognize). */
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

/** The game's item quality colors, poor..artifact. */
export const QUALITY_COLOR = ["#9d9d9d", "#ffffff", "#1eff00", "#0070dd", "#a335ee", "#ff8000", "#e6cc80"];

// ---------------------------------------------------------------- professions

export interface ItemRef {
  id: number;
  name: string;
  q: number;
  icon: string;
  count: number;
}

/** A recipe item ("Plans: …", "Pattern: …") that teaches a recipe. */
export interface RecipeItem {
  id: number;
  name: string;
  q: number;
  icon: string;
  /** Profession skill needed to learn it. */
  skill?: number;
}

export interface Recipe {
  spell: number;
  name: string;
  /** Skill needed to learn it, when the game files say (a recipe item's requirement); trainers keep it
   * server-side. It's orange (a sure skill-up) from here until `yellow`. */
  learn?: number;
  yellow: number;
  grey: number;
  creates: ItemRef | null;
  reagents: ItemRef[];
  /** Recipe category (TradeSkillCategory), e.g. "Plate Helmets". */
  cat?: number;
  /** What a recipe without an item does (enchantments). */
  desc?: string;
  tools?: string[];
  /** Crafting station needed nearby, e.g. "Anvil". */
  station?: string;
  /** Seconds. */
  cooldown?: number;
  /** Skill points per craft when it isn't 1. */
  skillups?: number;
  /** Learned automatically with the profession. */
  auto?: true;
  learnedFrom?: RecipeItem[];
  new?: true;
  /** What Classic Era had where it differs. */
  classic?: { reagents?: ItemRef[]; yellow?: number; grey?: number };
}

export type ProfessionKind = "primary" | "gathering" | "secondary";

export interface ProfessionSummary {
  id: number;
  slug: string;
  name: string;
  kind: ProfessionKind;
  icon: string;
  recipes: number;
  new: number;
  changed: number;
}

export interface Profession extends Omit<ProfessionSummary, "recipes" | "new" | "changed"> {
  desc: string;
  ranks: { name: string; spell: number; desc: string }[];
  specs: { name: string; spell: number; desc: string }[];
  categories: { id: number; name: string }[];
  recipes: Recipe[];
  /** Gathering professions: the materials the game files class under it. */
  materials?: { type: string; items: Omit<ItemRef, "count">[] };
}

export const getProfessions = () => load<ProfessionSummary[]>("professions/index.json");
export const getProfession = (slug: string) => load<Profession>(`professions/${slug}.json`);
/** Every profession at once (search, crafting list). */
export const getAllProfessions = async () => Promise.all((await getProfessions()).map((p) => getProfession(p.slug)));

export const KIND_LABEL: Record<ProfessionKind, string> = { primary: "Crafting", gathering: "Gathering", secondary: "Secondary" };

/** The skill-up color of a recipe at a given skill, as the game shows it in the profession window. */
export type Difficulty = "orange" | "yellow" | "green" | "grey" | "unlearnable";
export const greenAt = (r: Recipe) => Math.round((r.yellow + r.grey) / 2);
/** "300", or "?" when only a trainer knows. */
export const learnText = (r: Recipe) => (r.learn ? String(r.learn) : "?");
export function difficulty(r: Recipe, skill: number): Difficulty {
  if (r.learn && skill < r.learn) return "unlearnable";
  if (!r.yellow || !r.grey) return "grey";
  if (skill < r.yellow) return "orange";
  if (skill < greenAt(r)) return "yellow";
  if (skill < r.grey) return "green";
  return "grey";
}
