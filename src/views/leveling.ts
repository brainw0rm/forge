// Leveling planner: what happens at each level from 1 to 60 for a class and build:
// talent points (from the build's order), trainer abilities, and dungeons that open up.

import { adSlot, fillAds, withRail } from "../ads";
import { api, type SavedBuild } from "../api";
import { Build, decode, indexClass, split } from "../build";
import { classColor, getClass, getDungeons, getLeveling, getMeta, iconUrl, type Dungeon } from "../data";
import { navigate } from "../router";
import { currentUser } from "../session";
import { esc, setTitle } from "../ui";

interface Row {
  talents: { name: string; icon: string; rank: number; max: number }[];
  abilities: { name: string; rank: string; icon: string; upgrade: boolean; passive: boolean }[];
  dungeons: Dungeon[];
}

const PREFS_KEY = "ff:leveling-filters";

export async function renderLeveling(root: HTMLElement, parts: string[]) {
  const meta = await getMeta();
  const slug = meta.classes.some((c) => c.slug === parts[0]) ? parts[0] : meta.classes[0].slug;
  const code = parts[1] ?? "";
  const [cls, { abilities }, { dungeons, source }] = await Promise.all([getClass(slug), getLeveling(slug), getDungeons()]);
  const idx = indexClass(cls);
  const build = new Build(idx, cls.trees.length, decode(code));
  setTitle(`${cls.name} leveling planner`, `Level-by-level ${cls.name} plan for World of Warcraft: Forever: talents, trainer abilities and dungeons.`);

  const user = await currentUser();
  const [mine, top] = await Promise.all([
    user ? api.myBuilds().then((r) => r.builds.filter((b) => b.class === slug), () => []) : Promise.resolve([] as SavedBuild[]),
    api.builds({ class: slug, sort: "top" }).then((r) => r.builds, () => [] as SavedBuild[]),
  ]);

  const prefs = loadPrefs();
  const rows = new Map<number, Row>();
  const row = (level: number) => {
    let r = rows.get(level);
    if (!r) rows.set(level, (r = { talents: [], abilities: [], dungeons: [] }));
    return r;
  };

  // Talent points: point N is spent at level 9 + N.
  const ranks = new Map<number, number>();
  const learnedAt = new Map<number, number>();
  build.order.forEach((id, i) => {
    const t = idx.byId.get(id)!;
    const r = (ranks.get(id) ?? 0) + 1;
    ranks.set(id, r);
    if (!learnedAt.has(id)) learnedAt.set(id, 10 + i);
    row(10 + i).talents.push({ name: t.name, icon: t.icon, rank: r, max: t.ranks.length });
  });

  // Trainer abilities; talent-gated ranks only once the build has that talent.
  const seenNames = new Set<string>();
  for (const a of abilities) {
    if (a.talent !== undefined) {
      const at = learnedAt.get(a.talent);
      if (at === undefined || at > a.level) continue;
    }
    const upgrade = seenNames.has(a.name);
    seenNames.add(a.name);
    row(a.level).abilities.push({ name: a.name, rank: a.rank, icon: a.icon, upgrade, passive: a.passive });
  }
  for (const d of dungeons) if (d.minLevel <= 60) row(d.minLevel).dungeons.push(d);

  const levels = [...rows.keys()].sort((a, b) => a - b);
  const newAbilities = abilities.filter((a) => !a.talent && !/Rank ([2-9]|\d\d)/.test(a.rank)).length;

  root.innerHTML = `
    <section class="page leveling" style="--class:${classColor(slug)}">
      <header class="page-head">
        <div>
          <h1>${esc(cls.name)} leveling planner</h1>
          <p class="lede">Every level from 1 to 60: the talent point your build spends, what your trainer teaches, and which dungeons open up.</p>
        </div>
        <div class="build-head-actions">
          <a class="btn" href="/talents/${slug}/${code}" data-link>${build.spent ? "Edit build in calculator" : "Plan talents in calculator"}</a>
        </div>
      </header>
      <nav class="class-tabs">
        ${meta.classes.map((c) => `<a href="/leveling/${c.slug}" data-link class="${c.slug === slug ? "active" : ""}" style="--c:${classColor(c.slug)}">${esc(c.name)}</a>`).join("")}
      </nav>
      <div class="lvl-toolbar">
        <div class="lvl-build">
          <span class="muted small">Talent build</span>
          <b>${build.spent ? `${esc(split(build))} · ${build.spent} points` : "None selected"}</b>
        </div>
        <select id="pick-build" aria-label="Use a saved build">
          <option value="">Use a saved build…</option>
          ${mine.length ? `<optgroup label="My builds">${mine.map((b) => `<option value="${esc(b.code)}">${esc(b.title)} (${esc(b.split)})</option>`).join("")}</optgroup>` : ""}
          ${top.length ? `<optgroup label="Top community builds">${top.slice(0, 12).map((b) => `<option value="${esc(b.code)}">${esc(b.title)} (${esc(b.split)})</option>`).join("")}</optgroup>` : ""}
        </select>
        <div class="lvl-filters" role="group" aria-label="Show">
          ${(["talents", "abilities", "upgrades", "dungeons"] as const)
            .map(
              (k) => `<label class="check-pill"><input type="checkbox" data-filter="${k}" ${prefs[k] ? "checked" : ""}/> ${
                { talents: "Talent points", abilities: "New abilities", upgrades: "Rank upgrades", dungeons: "Dungeons & raids" }[k]
              }</label>`,
            )
            .join("")}
        </div>
      </div>
      <p class="muted small">${newAbilities} abilities and ${dungeons.length} dungeons and raids for ${esc(cls.name)}. Ability levels and
        most dungeon levels come from the game client; dungeons marked <span class="tag tag-announced">announced</span> aren't in the client
        yet and use <a href="${esc(source)}" rel="noopener">the ranges Blizzard announced</a>.</p>
      ${withRail(`<ol class="lvl-timeline" id="timeline">
        ${levels.map((lv) => levelRow(lv, rows.get(lv)!)).join("")}
      </ol>`)}
      ${adSlot("leaderboard", "narrow-only")}
    </section>`;

  const timeline = root.querySelector<HTMLElement>("#timeline")!;
  const applyFilters = () => {
    for (const [k, v] of Object.entries(prefs)) timeline.classList.toggle(`hide-${k}`, !v);
    // Drop levels where every entry is filtered out.
    timeline.querySelectorAll<HTMLElement>(".lvl-level").forEach((li) => {
      const kinds = [...li.querySelectorAll(".lvl-item")].map((i) => [...i.classList].find((c) => c.startsWith("k-"))!.slice(2));
      li.hidden = !kinds.some((k) => prefs[k as keyof typeof prefs]);
    });
  };
  applyFilters();
  root.querySelectorAll<HTMLInputElement>("[data-filter]").forEach((cb) =>
    cb.addEventListener("change", () => {
      prefs[cb.dataset.filter as keyof typeof prefs] = cb.checked;
      savePrefs(prefs);
      applyFilters();
    }),
  );
  root.querySelector<HTMLSelectElement>("#pick-build")!.addEventListener("change", (e) => {
    const value = (e.target as HTMLSelectElement).value;
    if (value) navigate(`/leveling/${slug}/${value}`);
  });
  fillAds(root);
}

function levelRow(level: number, r: Row) {
  const items = [
    ...r.talents.map(
      (t) => `<li class="lvl-item k-talents"><img src="${iconUrl(t.icon)}" alt="" loading="lazy" />
        <span><b>${esc(t.name)}</b> <small>${t.rank}/${t.max}</small></span><span class="tag tag-talent">Talent</span></li>`,
    ),
    ...r.abilities.map(
      (a) => `<li class="lvl-item ${a.upgrade ? "k-upgrades" : "k-abilities"}"><img src="${iconUrl(a.icon)}" alt="" loading="lazy" />
        <span><b>${esc(a.name)}</b> ${a.rank ? `<small>${esc(a.rank)}</small>` : ""}</span>
        <span class="tag ${a.upgrade ? "tag-upgrade" : "tag-ability"}">${a.upgrade ? "Rank up" : a.passive ? "Passive" : "New ability"}</span></li>`,
    ),
    ...r.dungeons.map(
      (d) => `<li class="lvl-item k-dungeons"><span class="dungeon-icon ${d.kind}" aria-hidden="true">${d.kind === "raid" ? "R" : "D"}</span>
        <span><b>${esc(d.name)}</b> <small>${
          d.source === "announced"
            ? `levels ${d.minLevel}–${d.maxLevel}${d.size ? ` · ${d.size}-player` : ""}`
            : `from level ${d.minLevel}${d.announced ? ` · announced ${d.announced.min}–${d.announced.max}` : ""}`
        }</small></span>
        ${d.isNew ? `<span class="tag tag-new">New in Forever</span>` : ""}
        ${d.source === "announced" ? `<span class="tag tag-announced">announced</span>` : ""}</li>`,
    ),
  ];
  return `<li class="lvl-level"><span class="lvl-num">${level}</span><ul>${items.join("")}</ul></li>`;
}

function loadPrefs() {
  const defaults = { talents: true, abilities: true, upgrades: false, dungeons: true };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") };
  } catch {
    return defaults;
  }
}

function savePrefs(p: object) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* private mode */
  }
}
