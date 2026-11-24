// Building blocks shared by the crafting pages: links, skill-up color bars, reagent chips, recipe
// cards, and the crafting list kept in the browser.

import { difficulty, greenAt, iconUrl, learnText, QUALITY_COLOR, type Difficulty, type ItemRef, type Profession, type Recipe } from "./data";
import { esc } from "./ui";

export const recipeUrl = (slug: string, spell: number) => `/professions/${slug}/${spell}`;
export const qColor = (q: number) => QUALITY_COLOR[q] ?? QUALITY_COLOR[1];

export function duration(sec: number) {
  if (sec >= 86400 && sec % 3600 === 0) return `${+(sec / 86400).toFixed(1)} day${sec === 86400 ? "" : "s"}`;
  if (sec >= 3600) return `${+(sec / 3600).toFixed(1)} hour${sec === 3600 ? "" : "s"}`;
  if (sec >= 60) return `${Math.round(sec / 60)} min`;
  return `${sec} sec`;
}

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  orange: "Orange: always a skill-up",
  yellow: "Yellow: usually a skill-up",
  green: "Green: sometimes a skill-up",
  grey: "Grey: no skill-up",
  unlearnable: "Your skill is too low to learn it",
};

/** The four skill-up colors as a bar with the skill where each starts. */
export function skillBar(r: Recipe) {
  if (!r.yellow || !r.grey || r.grey <= (r.learn ?? 0)) {
    return `<div class="skill-bar none"><span class="sk sk-learn">${learnText(r)}</span><span class="muted">no skill-ups</span></div>`;
  }
  const green = greenAt(r);
  const seg = (cls: string, from: number, to: number, label: string) =>
    to > from ? `<span class="sk ${cls}" style="flex:${to - from}" title="${label} from ${from}">${from}</span>` : "";
  // Where orange starts (the skill to learn it) is unknown for trainer recipes: a short "?" segment.
  const orange = r.learn
    ? seg("sk-o", r.learn, r.yellow, "Orange")
    : `<span class="sk sk-o unknown" title="Orange from the skill a trainer teaches it at (not in the game files)">?</span>`;
  return `<div class="skill-bar" aria-label="Orange from ${learnText(r)}, yellow from ${r.yellow}, green from ${green}, grey from ${r.grey}">
      ${orange}${seg("sk-y", r.yellow, green, "Yellow")}${seg("sk-g", green, r.grey, "Green")}<span class="sk sk-x" title="Grey from ${r.grey}">${r.grey}</span>
    </div>`;
}

export const itemIcon = (i: { icon: string; q: number }, cls = "") =>
  `<img class="ico ${cls}" src="${iconUrl(i.icon)}" alt="" loading="lazy" style="--q:${qColor(i.q)}" />`;

/** A reagent: icon with its count, name in its quality color, item tooltip on hover/tap. */
export const reagentChip = (i: ItemRef, times = 1) =>
  `<a class="reagent" href="/items/${i.id}" data-link data-tip-item="${i.id}" style="--q:${qColor(i.q)}">
    ${itemIcon(i)}<b class="n">${i.count * times > 1 ? i.count * times : ""}</b><span>${esc(i.name)}</span></a>`;

/** One recipe as a parchment card: result, skill colors, reagents, and how it's made. */
export function recipeCard(slug: string, r: Recipe, skill: number | null) {
  const out = r.creates;
  const diff = skill === null ? "" : difficulty(r, skill);
  const facts = [
    r.station ? `<span><i>Station</i> ${esc(r.station)}</span>` : "",
    r.tools?.length ? `<span><i>Tools</i> ${esc(r.tools.join(", "))}</span>` : "",
    r.cooldown ? `<span><i>Cooldown</i> ${duration(r.cooldown)}</span>` : "",
    r.learnedFrom ? `<span><i>Recipe</i> ${esc(r.learnedFrom[0].name)}</span>` : r.auto ? `<span><i>Learned</i> with the profession</span>` : "",
  ].filter(Boolean);
  return `<article class="recipe-card ${diff ? `is-${diff}` : ""}">
      <a class="rc-head" href="${recipeUrl(slug, r.spell)}" data-link>
        ${out ? itemIcon(out, "rc-icon") : `<span class="ico rc-icon blank" aria-hidden="true">✦</span>`}
        <span class="rc-title">
          <span class="rc-name" ${out ? `style="--q:${qColor(out.q)}"` : ""}>${esc(r.name)}${out && out.count > 1 ? ` <small>×${out.count}</small>` : ""}</span>
          <span class="rc-badges">${r.new ? `<span class="tag tag-new">New</span>` : ""}${r.classic ? `<span class="tag tag-changed">Changed</span>` : ""}${
            diff ? `<span class="tag tag-${diff}" title="${DIFFICULTY_LABEL[diff]}">${diff === "unlearnable" ? `needs ${r.learn}` : diff}</span>` : ""
          }</span>
        </span>
      </a>
      ${skillBar(r)}
      ${r.desc && !out ? `<p class="rc-desc">${esc(r.desc)}</p>` : ""}
      <div class="rc-reagents">${r.reagents.map((i) => reagentChip(i)).join("")}</div>
      <footer class="rc-foot">
        <span class="rc-facts">${facts.join("")}</span>
        <button type="button" class="btn small rc-add" data-add="${slug}:${r.spell}" aria-label="Add ${esc(r.name)} to the crafting list">+ List</button>
      </footer>
    </article>`;
}

// ---------------------------------------------------------------- crafting list

export interface ListEntry {
  slug: string;
  spell: number;
  n: number;
}

const LIST_KEY = "ff-crafting-list";

function readList(): ListEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LIST_KEY) ?? "[]") as ListEntry[];
    return Array.isArray(raw) ? raw.filter((e) => e && typeof e.slug === "string" && e.spell > 0 && e.n > 0) : [];
  } catch {
    return [];
  }
}

export const craftingList = {
  get: readList,
  save(list: ListEntry[]) {
    try {
      localStorage.setItem(LIST_KEY, JSON.stringify(list));
    } catch {
      /* private mode: the list just isn't kept */
    }
    window.dispatchEvent(new Event("ff:list"));
  },
  add(slug: string, spell: number, n = 1) {
    const list = readList();
    const e = list.find((x) => x.slug === slug && x.spell === spell);
    if (e) e.n += n;
    else list.push({ slug, spell, n });
    this.save(list);
  },
  count: () => readList().reduce((n, e) => n + e.n, 0),
};

/** "+ List" buttons under `root` (data-add="slug:spell"). */
export function wireAddButtons(root: HTMLElement, onAdd: (name: string) => void) {
  root.addEventListener("click", (e) => {
    const btn = (e.target as Element).closest<HTMLButtonElement>("[data-add]");
    if (!btn) return;
    const [slug, spell] = btn.dataset.add!.split(":");
    craftingList.add(slug, Number(spell));
    btn.classList.add("added");
    btn.textContent = "✓ Added";
    onAdd(btn.getAttribute("aria-label")?.replace(/^Add | to the crafting list$/g, "") ?? "Recipe");
  });
}

/** Which recipe makes each item, across professions, for breaking reagents down. When several do, the
 * plain one wins over a cooldown (smelting a bar rather than transmuting it). Left out, so they count
 * as raw materials: what skinning, herbalism and fishing gather (leather "upgrades" would otherwise
 * turn into thousands of scraps), and two-way conversions like lesser and greater essences. */
export function makersOf(profs: Profession[]) {
  const map = new Map<number, { slug: string; recipe: Recipe }>();
  const kind = new Map(profs.map((p) => [p.slug, p.kind]));
  const rank = (slug: string, r: Recipe) => (r.cooldown ? 2 : 0) + (kind.get(slug) === "gathering" ? 0 : 1);
  const gathered = new Set(profs.filter((p) => p.slug !== "mining").flatMap((p) => p.materials?.items.map((i) => i.id) ?? []));
  for (const p of profs) {
    for (const r of p.recipes) {
      if (!r.creates || gathered.has(r.creates.id)) continue;
      const have = map.get(r.creates.id);
      if (!have || rank(p.slug, r) < rank(have.slug, have.recipe)) map.set(r.creates.id, { slug: p.slug, recipe: r });
    }
  }
  const twoWay = [...map].filter(([id, m]) => m.recipe.reagents.some((i) => map.get(i.id)?.recipe.reagents.some((j) => j.id === id)));
  for (const [id] of twoWay) map.delete(id);
  return map;
}
