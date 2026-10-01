import { Build, decode, encode, indexClass, MAX_POINTS, split, type Index } from "../build";
import {
  buildNumber,
  classColor,
  clientLabel,
  getChangelog,
  getClass,
  getMeta,
  iconUrl,
  STATUS_LABEL,
  type Change,
  type ClassData,
  type Status,
  type Talent,
} from "../data";
import { adSlot, fillAds, withRail } from "../ads";
import { api, ApiError, type SavedBuild, type TalentStats } from "../api";
import { busy, formError, openModal } from "../modal";
import { navigate } from "../router";
import { currentUser, loginUrl } from "../session";
import { checkDescription, checkTitle, LIMITS } from "../../shared/validate";
import { watchButtonHtml, wireWatchButton } from "../watch";
import { copy, diffWords, esc, gameText, setTitle, toast } from "../ui";

const STEP = 64; // grid units per tier/column (48px cell + 16px gap)
const CELL = 48;
const COLS = 4;
const TIERS = 7;
const LENS_STATUSES: Status[] = ["new", "reworked", "expanded", "tuned", "unverified"];
const MIN_SAMPLE = 5;

type Lens = "off" | "changes" | "popularity";
const LENSES: { id: Lens; label: string; title: string }[] = [
  { id: "off", label: "Off", title: "No overlay" },
  { id: "changes", label: "Changes", title: "Highlight what changed from Classic Era" },
  { id: "popularity", label: "Popularity", title: "How often public builds take each talent" },
];
const parseLens = (v: string | null): Lens => (v === "1" ? "changes" : LENSES.some((l) => l.id === v) ? (v as Lens) : "off");

interface State {
  cls: ClassData;
  idx: Index;
  build: Build;
  /** Points shown while scrubbing the leveling timeline; null = whole build. */
  preview: number | null;
  lens: Lens;
  /** Popularity data, loaded the first time the popularity lens is used. */
  stats: TalentStats | null | "loading";
  hover: number | null;
  sheet: number | null; // talent open in the touch sheet
  mobileTree: number; // tree shown on narrow screens
  stale: { since: string; changes: Change[] } | null;
  /** Saved build being edited (opened with ?edit=<id>). */
  editing: SavedBuild | null;
}

let lastPointer = "mouse";

export async function renderTalents(root: HTMLElement, slug: string, code: string, params: URLSearchParams) {
  const [meta, cls] = await Promise.all([getMeta(), getClass(slug)]);
  const idx = indexClass(cls);
  const wanted = decode(code);
  const build = new Build(idx, cls.trees.length, wanted);
  const state: State = {
    cls,
    idx,
    build,
    preview: null,
    lens: parseLens(params.get("lens") ?? localStorageGet("lens")),
    stats: null,
    hover: null,
    sheet: null,
    stale: null,
    mobileTree: 0,
    editing: null,
  };
  const editId = params.get("edit");
  if (editId) {
    const saved = await api.build(editId).catch(() => null);
    if (saved?.build.mine && saved.build.class === slug) state.editing = saved.build;
  }
  // Open phones on the tree the build invests in most, or on the talent a search result points to.
  state.mobileTree = build.treePoints.indexOf(Math.max(...build.treePoints));
  const spotlight = Number(params.get("t"));
  if (idx.treeOf.has(spotlight)) state.mobileTree = idx.treeOf.get(spotlight)!;

  // Links remember the game build they were made on; flag talents changed since.
  const madeOn = Number(params.get("b"));
  if (madeOn && madeOn < buildNumber(meta.build) && build.spent) {
    const log = await getChangelog();
    const used = new Set(build.order);
    const changes = log
      .filter((e) => buildNumber(e.build) > madeOn)
      .flatMap((e) => e.changes)
      .filter((c) => c.class === slug && used.has(c.talent));
    state.stale = { since: String(madeOn), changes };
  }

  setTitle(`${cls.name} talent calculator`, `Plan a ${cls.name} build for World of Warcraft: Forever with live game data.`);
  // Say so when a shared link didn't fully load (wrong class, typo, or talents removed since).
  const dropped = (code && !wanted.length ? 1 : 0) || wanted.length - build.spent;
  if (dropped > 0) {
    toast(
      build.spent
        ? `${dropped} point${dropped === 1 ? "" : "s"} from this link couldn't be applied: the talents may have changed since it was made.`
        : "This link's build code isn't valid for this class, so the calculator starts empty.",
    );
  }

  root.innerHTML = `
    <section class="calc" style="--class:${classColor(cls.slug)}">
      <nav class="class-tabs" aria-label="Classes">
        ${meta.classes
          .map(
            (c) =>
              `<a href="/talents/${c.slug}" data-link class="${c.slug === slug ? "active" : ""}" style="--c:${classColor(c.slug)}">${esc(c.name)}</a>`,
          )
          .join("")}
      </nav>
      <div class="calc-head">
        <div class="calc-title">
          <h1>${esc(cls.name)}</h1>
          <div class="calc-split" id="split"></div>
        </div>
        <dl class="calc-stats" id="stats"></dl>
        <div class="calc-actions">
          <div class="lens-switch" role="group" aria-label="Lens">
            ${LENSES.map(
              (l) => `<button class="lens-btn" data-lens="${l.id}" aria-pressed="${state.lens === l.id}" title="${l.title}">${l.label}</button>`,
            ).join("")}
          </div>
          <button class="btn primary" id="save">${state.editing ? "Update build" : "Save build"}</button>
          <button class="btn" id="copy-link">Copy link</button>
          ${watchButtonHtml(`Watch ${cls.name}`)}
          <details class="more-menu">
            <summary class="btn">More</summary>
            <div class="menu">
              <button type="button" id="compare">Compare with another build</button>
              <button type="button" id="leveling">Leveling plan</button>
              <button type="button" id="copy-text">Copy as text</button>
              <button type="button" id="reset" class="danger-text">Reset all points</button>
            </div>
          </details>
        </div>
      </div>
      ${
        state.editing
          ? `<div class="editing-note">Editing <a href="/builds/${esc(state.editing.id)}" data-link>${esc(state.editing.title)}</a>. Changes aren't saved until you press <b>Update build</b>.</div>`
          : ""
      }
      ${withRail(`
      <div id="stale"></div>
      <div class="lens-legend" id="legend"></div>
      <div class="tree-switch" id="tree-switch" role="tablist" aria-label="Talent trees"></div>
      <div class="trees" id="trees"></div>
      ${adSlot("leaderboard", "calc-ad narrow-only")}
      <section class="timeline" id="timeline"></section>
      <details class="removed" id="removed"></details>`)}
      <p class="data-note">Data from the ${esc(clientLabel(meta))} ${esc(cls.build)}, compared with Classic Era ${esc(cls.classicBuild)}.
        Most talents only ship rank 1 in the client data; other ranks are shown only when verifiable.
        <button type="button" class="link-btn" data-report-bug data-kind="data">Spotted wrong game data?</button></p>
    </section>
    <div class="tooltip" id="tooltip" role="tooltip" hidden></div>
    <div class="sheet" id="sheet" hidden></div>`;

  const update = (next: Build) => {
    state.build = next;
    state.preview = null;
    state.stale = state.stale && next.spent ? state.stale : null;
    syncUrl(state);
    draw(root, state, update);
  };
  if (dropped > 0) syncUrl(state); // the address shows what's actually loaded

  root.querySelectorAll<HTMLButtonElement>("[data-lens]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      state.lens = parseLens(btn.dataset.lens ?? "off");
      localStorageSet("lens", state.lens);
      if (state.lens === "popularity" && state.stats === null) {
        state.stats = "loading";
        draw(root, state, update);
        state.stats = await api.talentStats(cls.slug).catch(() => null);
      }
      draw(root, state, update);
    }),
  );
  if (state.lens === "popularity") {
    state.stats = "loading";
    api.talentStats(cls.slug).then(
      (st) => ((state.stats = st), draw(root, state, update)),
      () => ((state.stats = null), draw(root, state, update)),
    );
  }
  root.querySelector("#reset")!.addEventListener("click", () => update(new Build(idx, cls.trees.length)));
  root.querySelector("#copy-link")!.addEventListener("click", () => copy(shareUrl(state), "Link copied"));
  root.querySelector("#copy-text")!.addEventListener("click", () => copy(asText(state), "Build copied as text"));
  root.querySelector("#save")!.addEventListener("click", () => saveBuild(state, meta.build));
  root.querySelector("#leveling")!.addEventListener("click", () =>
    navigate(`/leveling/${cls.slug}/${encode(state.build.order)}`),
  );
  root.querySelector("#compare")!.addEventListener("click", () =>
    navigate(`/compare/${cls.slug}/${encode(state.build.order) || "-"}/-`),
  );
  root.addEventListener("pointerdown", (e) => (lastPointer = (e as PointerEvent).pointerType), { capture: true });

  document.addEventListener("keydown", onKey);
  function onKey(e: KeyboardEvent) {
    if (!document.body.contains(root.querySelector(".calc"))) return document.removeEventListener("keydown", onKey);
    if (e.key === "Escape") closeSheet(root, state);
  }

  draw(root, state, update);
  wireWatchButton(root.querySelector("[data-watch]"), "class", cls.slug, `Watch ${cls.name}`);
  root.querySelector(".class-tabs a.active")?.scrollIntoView({ block: "nearest", inline: "center" });
  if (idx.treeOf.has(spotlight)) {
    // Coming from search: bring the talent into view and make it pulse, then drop ?t from the address.
    const el = root.querySelector<HTMLElement>(`.trees .talent[data-id="${spotlight}"]`);
    // After the router's scroll-to-top for the new page.
    setTimeout(() => el?.scrollIntoView({ block: "center" }), 0);
    el?.classList.add("spotlight");
    const q = new URLSearchParams(location.search);
    q.delete("t");
    history.replaceState(null, "", location.pathname + (q.size ? `?${q}` : ""));
  }
  fillAds(root);
}

// ---------------------------------------------------------------- drawing

function draw(root: HTMLElement, s: State, update: (b: Build) => void) {
  const shown = s.preview === null ? s.build : s.build.truncate(s.preview);
  const full = s.build;

  root.querySelector<HTMLElement>(".calc")!.classList.toggle("lens-on", s.lens === "changes");
  root.querySelector<HTMLElement>(".calc")!.classList.toggle("heat-on", s.lens === "popularity");
  root.querySelectorAll<HTMLElement>("[data-lens]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lens === s.lens)));
  root.querySelector("#split")!.textContent = split(shown);
  root.querySelector("#stats")!.innerHTML = `
    <div><dt>Points spent</dt><dd>${shown.spent}<small>/${MAX_POINTS}</small></dd></div>
    <div><dt>Required level</dt><dd>${shown.level}</dd></div>
    <div><dt>Points left</dt><dd>${MAX_POINTS - shown.spent}</dd></div>`;

  drawStale(root, s, update);
  drawLegend(root, s);

  const switcher = root.querySelector<HTMLElement>("#tree-switch")!;
  switcher.innerHTML = s.cls.trees
    .map(
      (tree, ti) => `<button role="tab" aria-selected="${ti === s.mobileTree}" data-show-tree="${ti}">
          ${esc(tree.name)} <b>${shown.treePoints[ti]}</b></button>`,
    )
    .join("");
  switcher.querySelectorAll<HTMLButtonElement>("[data-show-tree]").forEach((btn) =>
    btn.addEventListener("click", () => {
      s.mobileTree = Number(btn.dataset.showTree);
      draw(root, s, update);
    }),
  );
  root.querySelector<HTMLElement>("#trees")!.dataset.show = String(s.mobileTree);

  root.querySelector("#trees")!.innerHTML = s.cls.trees
    .map((_, ti) => treeHtml(s.cls, s.idx, ti, shown, full, { interactive: s.preview === null, heat: heatFor(s) }))
    .join("");

  drawTimeline(root, s, update);
  drawRemoved(root, s);
  wireTrees(root, s, update);
  // Re-rendering swaps the hovered element without a mouseleave, so re-check hover.
  const hovered = s.hover !== null && root.querySelector(`.talent[data-id="${s.hover}"]:hover`);
  if (hovered) showTooltip(root, s, s.hover!);
  else hideTooltip(root, s);
  if (s.sheet !== null) openSheet(root, s, s.sheet, update);
}

/** Markup for one talent tree. `full` differs from `shown` while previewing a lower level. */
function treeHtml(
  cls: ClassData,
  idx: Index,
  ti: number,
  shown: Build,
  full: Build,
  { interactive, heat }: { interactive: boolean; heat?: Map<number, number> | null },
): string {
  return treeGridHtml(cls, idx, ti, shown, {
    interactive,
    points: shown.treePoints[ti],
    cell: (t) => {
      const r = shown.rank(t.id);
      const fr = full.rank(t.id);
      const max = t.ranks.length;
      const state = r >= max ? "maxed" : r > 0 ? "partial" : interactive && shown.canAdd(t.id) ? "open" : "locked";
      return {
        className: `${state} ${fr > r ? "ghost" : ""}`,
        badge: `${fr > r ? `${r}<i>→${fr}</i>` : r}/${max}`,
        label: `${t.name}, rank ${r} of ${max}`,
        title: interactive ? "" : `${t.name} ${r}/${max}\n${t.ranks[Math.max(r - 1, 0)] || t.ranks[0]}`,
        heat: heat ? (heat.get(t.id) ?? 0) : undefined,
      };
    },
  });
}

export interface CellView {
  className: string;
  badge: string;
  label: string;
  title?: string;
  /** 0..1 share of builds that took this talent (popularity lens). */
  heat?: number;
}

/** Generic tree grid: layout, arrows and icons, with per-talent state supplied by `cell`. */
export function treeGridHtml(
  cls: ClassData,
  idx: Index,
  ti: number,
  arrowBuild: Build,
  opts: { interactive: boolean; points: number | string; cell: (t: Talent) => CellView },
): string {
  const tree = cls.trees[ti];
  const talents = tree.talents
    .map((t) => {
      const v = opts.cell(t);
      const left = ((t.col * STEP + (STEP - CELL) / 2) / (COLS * STEP)) * 100;
      const top = ((t.tier * STEP + (STEP - CELL) / 2) / (TIERS * STEP)) * 100;
      const tag = opts.interactive ? "button" : "span";
      const heat = v.heat === undefined ? "" : `;--heat:${v.heat.toFixed(3)}`;
      return `<${tag} class="talent ${v.className} st-${t.status}${t.active ? " active-spell" : ""}"
          data-id="${t.id}" style="left:${left}%;top:${top}%${heat}"${v.title ? ` title="${esc(v.title)}"` : ""}
          aria-label="${esc(v.label)}${v.heat === undefined ? "" : `, taken by ${Math.round(v.heat * 100)}% of builds`}">
          <img src="${iconUrl(t.icon)}" alt="" loading="lazy" decoding="async" />
          <span class="rank">${v.badge}</span>
          ${v.heat ? `<span class="heat">${Math.round(v.heat * 100)}%</span>` : ""}
          <span class="mark" aria-hidden="true"></span>
        </${tag}>`;
    })
    .join("");
  return `<article class="tree" data-tree="${ti}">
      <header>
        <img src="${iconUrl(tree.icon)}" alt="" />
        <h2>${esc(tree.name)}</h2>
        <span class="tree-points">${opts.points}</span>
        ${
          opts.interactive
            ? `<button class="tree-reset" data-tree-reset="${ti}" title="Reset ${esc(tree.name)}" aria-label="Reset ${esc(tree.name)}">↺</button>`
            : ""
        }
      </header>
      <div class="grid">
        <svg class="arrows" viewBox="0 0 ${COLS * STEP} ${TIERS * STEP}" aria-hidden="true">${arrows(idx, arrowBuild, tree.talents)}</svg>
        ${talents}
      </div>
    </article>`;
}

/** One read-only tree for animated previews: talents that could take the next point show as open. */
export function playbackTreeHtml(cls: ClassData, idx: Index, ti: number, b: Build): string {
  return treeGridHtml(cls, idx, ti, b, {
    interactive: false,
    points: b.treePoints[ti],
    cell: (t) => {
      const r = b.rank(t.id);
      const max = t.ranks.length;
      return {
        className: r >= max ? "maxed" : r > 0 ? "partial" : b.canAdd(t.id) ? "open" : "locked",
        badge: `${r}/${max}`,
        label: `${t.name}, rank ${r} of ${max}`,
      };
    },
  });
}

/** Read-only trees for a saved build (build pages, previews). */
export function staticTreesHtml(cls: ClassData, order: number[], only?: number): string {
  const idx = indexClass(cls);
  const b = new Build(idx, cls.trees.length, order);
  const trees = only === undefined ? cls.trees.map((_, i) => i) : [only];
  return trees.map((ti) => treeHtml(cls, idx, ti, b, b, { interactive: false })).join("");
}

function arrows(idx: Index, b: Build, talents: Talent[]): string {
  const center = (t: Talent) => [t.col * STEP + STEP / 2, t.tier * STEP + STEP / 2];
  const half = CELL / 2;
  return talents
    .filter((t) => t.prereq && idx.byId.has(t.prereq.id))
    .map((t) => {
      const p = idx.byId.get(t.prereq!.id)!;
      const [px, py] = center(p);
      const [tx, ty] = center(t);
      let d: string;
      if (p.tier === t.tier) {
        const dir = Math.sign(tx - px);
        d = `M${px + dir * half} ${py} H${tx - dir * (half + 6)}`;
      } else if (p.col === t.col) {
        d = `M${px} ${py + half} V${ty - half - 6}`;
      } else {
        const dir = Math.sign(tx - px);
        d = `M${px + dir * half} ${py} H${tx} V${ty - half - 6}`;
      }
      const lit = b.rank(t.id) > 0 || (b.rank(p.id) >= t.prereq!.rank && b.canAdd(t.id));
      return `<path d="${d}" class="${lit ? "lit" : ""}" marker-end="url(#${lit ? "head-lit" : "head"})"/>`;
    })
    .join("")
    .concat(`<defs>
      <marker id="head" viewBox="0 0 10 10" refX="2" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L10 5L0 10z" class="head"/></marker>
      <marker id="head-lit" viewBox="0 0 10 10" refX="2" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L10 5L0 10z" class="head lit"/></marker>
    </defs>`);
}

function drawLegend(root: HTMLElement, s: State) {
  const el = root.querySelector<HTMLElement>("#legend")!;
  if (s.lens === "off") {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  if (s.lens === "popularity") {
    const st = s.stats;
    if (st === "loading") el.innerHTML = `<span class="legend-title">Loading popularity…</span>`;
    else if (!st) el.innerHTML = `<span class="legend-title">Popularity data isn't available right now.</span>`;
    else {
      const b = bracketFor(s);
      const n = b ? b.builds : st.builds;
      el.innerHTML = `<span class="legend-title">Popularity</span>
        <span class="heat-scale" aria-hidden="true"></span>
        <span class="muted">Share of <b>${n}</b> public ${esc(s.cls.name)} build${n === 1 ? "" : "s"} that took each talent
          ${b ? `by level ${b.level}` : ""}${n < MIN_SAMPLE ? " — too few builds to be meaningful yet" : ""}.
          ${s.preview === null ? "Scrub the leveling path to see earlier levels." : ""}</span>`;
    }
    return;
  }
  const counts = new Map<Status, number>();
  for (const t of s.idx.byId.values()) counts.set(t.status, (counts.get(t.status) ?? 0) + 1);
  el.innerHTML =
    `<span class="legend-title">vs Classic Era</span>` +
    LENS_STATUSES.map(
      (st) => `<span class="chip st-${st}"><span class="swatch"></span>${STATUS_LABEL[st]} <b>${counts.get(st) ?? 0}</b></span>`,
    ).join("") +
    `<span class="chip dim">Unchanged <b>${(counts.get("unchanged") ?? 0) + (counts.get("moved") ?? 0)}</b></span>`;
}

/** Popularity sample for the level being previewed (whole builds when not previewing). */
function bracketFor(s: State) {
  if (!s.stats || s.stats === "loading" || s.preview === null) return null;
  const level = 9 + s.preview;
  const fits = s.stats.brackets.filter((b) => b.level <= level);
  return fits.length ? fits[fits.length - 1] : s.stats.brackets[0];
}

function heatFor(s: State): Map<number, number> | null {
  if (s.lens !== "popularity" || !s.stats || s.stats === "loading") return null;
  const b = bracketFor(s);
  const picks = b ? b.picks : s.stats.picks;
  const n = b ? b.builds : s.stats.builds;
  return new Map(Object.entries(picks).map(([id, c]) => [Number(id), n ? c / n : 0]));
}

function drawStale(root: HTMLElement, s: State, update: (b: Build) => void) {
  const el = root.querySelector<HTMLElement>("#stale")!;
  if (!s.stale) {
    el.innerHTML = "";
    return;
  }
  const { since, changes } = s.stale;
  el.innerHTML = `<div class="banner ${changes.length ? "warn" : "ok"}">
      <div>
        <strong>${
          changes.length
            ? `${changes.length} talent${changes.length > 1 ? "s" : ""} in this build changed since it was shared`
            : "This build is still current"
        }</strong>
        <span>Made on build ${esc(since)}.</span>
        ${
          changes.length
            ? `<ul>${changes
                .map((c) => {
                  const d = c.kinds?.includes("text") ? diffWords(c.before ?? "", c.after ?? "") : null;
                  return `<li><b>${esc(c.name)}</b> — ${esc(describeChange(c))}${
                    d ? `<div class="before-after"><p>${d.before}</p><p>${d.after}</p></div>` : ""
                  }</li>`;
                })
                .join("")}</ul>`
            : ""
        }
      </div>
      <button class="btn" id="stale-ok">Got it</button>
    </div>`;
  el.querySelector("#stale-ok")!.addEventListener("click", () => {
    s.stale = null;
    update(s.build);
  });
}

export function describeChange(c: Change): string {
  if (c.type === "added") return "added to the tree";
  if (c.type === "removed") return "removed from the tree";
  const parts: string[] = [];
  for (const k of c.kinds ?? []) {
    if (k === "text") parts.push("tooltip changed");
    if (k === "ranks") parts.push(`ranks ${c.beforeRanks} → ${c.afterRanks}`);
    if (k === "moved") parts.push("moved in the tree");
    if (k === "renamed") parts.push(`renamed from ${c.oldName}`);
    if (k === "prereq") parts.push("requirement changed");
  }
  return parts.join(", ");
}

function drawTimeline(root: HTMLElement, s: State, update: (b: Build) => void) {
  const el = root.querySelector<HTMLElement>("#timeline")!;
  const b = s.build;
  if (!b.spent) {
    el.innerHTML = `<div class="timeline-empty">
        <h3>Leveling path</h3>
        <p>Every point you spend is recorded in order, so your link doubles as a level-by-level leveling guide.
        Left-click a talent to learn it, right-click (or shift-click) to unlearn.</p>
      </div>`;
    return;
  }
  const shownPoints = s.preview ?? b.spent;
  const level = shownPoints ? 9 + shownPoints : 9;
  const ranks = new Map<number, number>();
  el.innerHTML = `
    <div class="timeline-head">
      <h3>Leveling path</h3>
      <label class="scrub">
        <span>Preview at level <b>${shownPoints ? level : "—"}</b></span>
        <input type="range" id="scrub" min="0" max="${b.spent}" value="${shownPoints}"
          aria-label="Preview the build at an earlier level" />
      </label>
      ${s.preview !== null ? `<button class="btn" id="scrub-reset">Show full build</button>` : ""}
    </div>
    <ol class="order">
      ${b.order
        .map((id, i) => {
          const t = s.idx.byId.get(id)!;
          const r = (ranks.get(id) ?? 0) + 1;
          ranks.set(id, r);
          const tree = s.cls.trees[s.idx.treeOf.get(id)!].name;
          return `<li class="${i >= shownPoints ? "future" : ""}" data-i="${i}">
              <span class="lvl">${10 + i}</span>
              <img src="${iconUrl(t.icon)}" alt="" loading="lazy" />
              <span class="name">${esc(t.name)} <small>${r}/${t.ranks.length} · ${esc(tree)}</small></span>
              <span class="move">
                <button data-move="-1" aria-label="Earlier" ${i === 0 ? "disabled" : ""}>↑</button>
                <button data-move="1" aria-label="Later" ${i === b.spent - 1 ? "disabled" : ""}>↓</button>
              </span>
            </li>`;
        })
        .join("")}
    </ol>`;

  const scrub = el.querySelector<HTMLInputElement>("#scrub")!;
  scrub.addEventListener("input", () => {
    const v = Number(scrub.value);
    s.preview = v >= b.spent ? null : v;
    draw(root, s, update);
    root.querySelector<HTMLInputElement>("#scrub")?.focus();
  });
  el.querySelector("#scrub-reset")?.addEventListener("click", () => {
    s.preview = null;
    draw(root, s, update);
  });
  el.querySelectorAll<HTMLButtonElement>("[data-move]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const i = Number(btn.closest("li")!.dataset.i);
      const to = i + Number(btn.dataset.move);
      const next = b.reorder(i, to);
      if (next === b) {
        btn.classList.add("nope");
        setTimeout(() => btn.classList.remove("nope"), 400);
        return;
      }
      update(next);
    }),
  );
}

function drawRemoved(root: HTMLElement, s: State) {
  const el = root.querySelector<HTMLElement>("#removed")!;
  const removed = s.cls.removed;
  el.hidden = removed.length === 0;
  el.innerHTML = `<summary>${removed.length} Classic Era talent${removed.length === 1 ? "" : "s"} no longer in the ${esc(s.cls.name)} trees</summary>
    <ul>${removed
      .map(
        (r) =>
          `<li><b>${esc(r.name)}</b> <small>${esc(r.tree)} · tier ${r.tier + 1}</small><p>${gameText(r.ranks[r.ranks.length - 1] || r.ranks[0])}</p></li>`,
      )
      .join("")}</ul>`;
}

// ---------------------------------------------------------------- interaction

function wireTrees(root: HTMLElement, s: State, update: (b: Build) => void) {
  const trees = root.querySelector<HTMLElement>("#trees")!;
  trees.querySelectorAll<HTMLButtonElement>(".talent").forEach((el) => {
    const id = Number(el.dataset.id);
    el.addEventListener("click", (e) => {
      if (lastPointer === "touch") return openSheet(root, s, id, update);
      if (e.shiftKey) update(s.build.remove(id));
      else update(s.build.add(id));
    });
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (lastPointer !== "touch") update(s.build.remove(id));
    });
    el.addEventListener("mouseenter", () => {
      if (lastPointer === "touch") return;
      s.hover = id;
      showTooltip(root, s, id);
    });
    el.addEventListener("mouseleave", () => hideTooltip(root, s));
    el.addEventListener("focus", () => {
      if (lastPointer !== "touch") showTooltip(root, s, id);
    });
    el.addEventListener("blur", () => hideTooltip(root, s));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" || e.key === "Delete" || e.key === "-") {
        e.preventDefault();
        update(s.build.remove(id));
        root.querySelector<HTMLElement>(`.talent[data-id="${id}"]`)?.focus();
      }
    });
  });
  trees.querySelectorAll<HTMLButtonElement>("[data-tree-reset]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const ti = Number(btn.dataset.treeReset);
      update(new Build(s.idx, s.cls.trees.length, s.build.order.filter((id) => s.idx.treeOf.get(id) !== ti)));
    }),
  );
}

function tooltipHtml(s: State, t: Talent): string {
  const b = s.preview === null ? s.build : s.build.truncate(s.preview);
  const r = b.rank(t.id);
  const max = t.ranks.length;
  const rankText = (i: number) => {
    const text = t.ranks[i];
    if (!text) return `<p class="unknown">Rank ${i + 1} values aren't in the game client yet.</p>`;
    const inferred = t.source === "forever" && i >= t.estimated;
    return `<p>${gameText(text)}</p>${inferred ? `<p class="fine">Rank ${i + 1} text from Classic Era; rank 1 is identical.</p>` : ""}`;
  };
  const blocker = r < max && s.preview === null ? b.addBlocker(t.id) : null;
  let classic = "";
  const why = t.reason
    ? `<p class="fine">${esc(t.reason)}</p>`
    : t.notes?.includes("reworded")
      ? `<p class="fine">Same effect and numbers as Classic Era; only the wording changed.</p>`
      : "";
  if (t.classic && t.status === "unchanged") classic = why && `<div class="tt-classic">${why}</div>`;
  if (t.classic && t.status !== "unchanged") {
    const diff = diffWords(t.classic.ranks[0] ?? "", t.ranks[0] ?? "");
    const renamed = t.classic.name !== t.name;
    const title = t.notes?.includes("replaces")
      ? `Replaces Classic's <b>${esc(t.classic.name)}</b>`
      : `In Classic Era${renamed ? ` as <b>${esc(t.classic.name)}</b>` : ""}`;
    const extra: string[] = [];
    if (t.classic.ranks.length !== max) extra.push(`${t.classic.ranks.length} rank${t.classic.ranks.length > 1 ? "s" : ""} in Classic`);
    if (t.notes?.includes("moved")) extra.push(`was tier ${t.classic.tier + 1}`);
    if (t.notes?.includes("moved-tree")) extra.push("was in another tree");
    classic = `<div class="tt-classic">
        <div class="tt-sub">${title}${extra.length ? ` · ${extra.join(" · ")}` : ""}</div>
        <p class="diff">${t.notes?.includes("replaces") ? esc(t.classic.ranks[0]) : diff.before}</p>
        ${t.notes?.includes("replaces") ? "" : `<div class="tt-sub">Rank 1 now</div><p class="diff">${diff.after}</p>`}
        ${why}
      </div>`;
  }
  return `
    <header>
      <img src="${iconUrl(t.icon)}" alt="" />
      <div>
        <h3>${esc(t.name)}</h3>
        <div class="tt-rank">Rank ${r}/${max}${t.active ? " · Active ability" : ""}</div>
      </div>
      <span class="badge st-${t.status}">${STATUS_LABEL[t.status]}</span>
    </header>
    ${t.source === "classic" ? `<p class="fine warn">Not in the game client yet; showing Classic Era text.</p>` : ""}
    ${t.source === "missing" ? `<p class="fine warn">No tooltip data in the game client yet.</p>` : ""}
    ${r > 0 ? rankText(r - 1) : ""}
    ${r > 0 && r < max ? `<div class="tt-sub">Next rank</div>` : ""}
    ${r < max ? rankText(r) : ""}
    ${blocker && blocker !== "Max rank" ? `<p class="req">${esc(blocker)}</p>` : ""}
    ${classic}
    <footer>${
      lastPointer === "touch" ? "" : "Click to learn · Right-click or shift-click to unlearn"
    }</footer>`;
}

function showTooltip(root: HTMLElement, s: State, id: number) {
  const t = s.idx.byId.get(id);
  const anchor = root.querySelector<HTMLElement>(`.talent[data-id="${id}"]`);
  const tip = root.querySelector<HTMLElement>("#tooltip");
  if (!t || !anchor || !tip) return;
  tip.innerHTML = tooltipHtml(s, t);
  tip.hidden = false;
  const a = anchor.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const margin = 12;
  let x = a.right + margin;
  if (x + w > window.innerWidth - 8) x = a.left - margin - w;
  if (x < 8) x = Math.max(8, Math.min(window.innerWidth - w - 8, a.left + a.width / 2 - w / 2));
  let y = a.top;
  if (y + h > window.innerHeight - 8) y = Math.max(8, window.innerHeight - h - 8);
  tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

function hideTooltip(root: HTMLElement, s: State) {
  s.hover = null;
  const tip = root.querySelector<HTMLElement>("#tooltip");
  if (tip) tip.hidden = true;
}

function openSheet(root: HTMLElement, s: State, id: number, update: (b: Build) => void) {
  const t = s.idx.byId.get(id)!;
  const sheet = root.querySelector<HTMLElement>("#sheet")!;
  s.sheet = id;
  sheet.hidden = false;
  sheet.innerHTML = `<div class="sheet-body">${tooltipHtml(s, t)}
      <div class="sheet-actions">
        <button class="btn" data-act="remove" ${s.build.canRemove(id) ? "" : "disabled"}>− Unlearn</button>
        <button class="btn primary" data-act="add" ${s.build.canAdd(id) ? "" : "disabled"}>+ Learn</button>
        <button class="btn ghost" data-act="close">Close</button>
      </div></div>`;
  sheet.querySelector('[data-act="add"]')!.addEventListener("click", () => update(s.build.add(id)));
  sheet.querySelector('[data-act="remove"]')!.addEventListener("click", () => update(s.build.remove(id)));
  sheet.querySelector('[data-act="close"]')!.addEventListener("click", () => closeSheet(root, s));
  sheet.onclick = (e) => {
    if (e.target === sheet) closeSheet(root, s);
  };
}

function closeSheet(root: HTMLElement, s: State) {
  s.sheet = null;
  const sheet = root.querySelector<HTMLElement>("#sheet");
  if (sheet) sheet.hidden = true;
}

// ---------------------------------------------------------------- saving

async function saveBuild(s: State, gameBuild: string) {
  const user = await currentUser();
  if (!user) {
    toast("Sign in to save builds");
    navigate(loginUrl());
    return;
  }
  if (!s.build.spent) {
    toast("Spend at least one talent point first");
    return;
  }
  const e = s.editing;
  const dlg = openModal(
    e ? "Update build" : "Save build",
    `<form class="form" novalidate>
      <label>Title
        <input name="title" required autofocus maxlength="${LIMITS.title.max}" value="${esc(e?.title ?? defaultTitle(s))}" />
      </label>
      <label><span>Description <span class="optional">(optional)</span></span>
        <textarea name="description" rows="5" maxlength="${LIMITS.description.max}"
          placeholder="When to use it, what to swap, leveling notes…">${esc(e?.description ?? "")}</textarea>
      </label>
      <label class="check">
        <input type="checkbox" name="isPublic" ${user.emailVerified && !(e && !e.isPublic) ? "checked" : ""} ${user.emailVerified ? "" : "disabled"} />
        <span>Public — list it in community builds so others can find and rate it${
          user.emailVerified ? "" : `<br><span class="hint">Confirm your email address to publish. <a href="/account" data-link>Resend the link</a></span>`
        }</span>
      </label>
      <p class="form-summary">${esc(s.cls.name)} ${esc(split(s.build))} · ${s.build.spent} points · build ${esc(gameBuild)}</p>
      <div class="form-actions">
        <button type="button" class="btn ghost" data-close>Cancel</button>
        <button class="btn primary" type="submit">${e ? "Update" : "Save"}</button>
      </div>
    </form>`,
  );
  const form = dlg.querySelector("form")!;
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const data = new FormData(form);
    const title = String(data.get("title") ?? "").trim();
    const description = String(data.get("description") ?? "").trim();
    const problem = checkTitle(title) ?? checkDescription(description);
    if (problem) return formError(form, problem);
    const input = {
      class: s.cls.slug,
      code: encode(s.build.order),
      split: split(s.build),
      title,
      description,
      isPublic: data.get("isPublic") === "on",
      gameBuild: buildNumber(gameBuild),
    };
    const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    busy(btn, true, "Saving…");
    try {
      const { build } = e ? await api.updateBuild(e.id, input) : await api.createBuild(input);
      s.editing = build;
      dlg.close();
      toast(e ? "Build updated" : "Build saved");
      navigate(`/builds/${build.id}`);
    } catch (err) {
      busy(btn, false);
      if (err instanceof ApiError && err.status === 401) return navigate(loginUrl());
      formError(form, err instanceof Error ? err.message : "Couldn't save the build.");
    }
  });
}

function defaultTitle(s: State) {
  const main = s.build.treePoints.indexOf(Math.max(...s.build.treePoints));
  return `${s.cls.trees[main].name} ${s.cls.name} ${split(s.build)}`;
}

// ---------------------------------------------------------------- sharing

function path(s: State) {
  const code = encode(s.build.order);
  return `/talents/${s.cls.slug}${code ? `/${code}` : ""}`;
}

function syncUrl(s: State) {
  const params = new URLSearchParams(location.search);
  if (!s.stale) params.delete("b");
  if (s.editing) params.set("edit", s.editing.id);
  const q = params.toString();
  history.replaceState(null, "", path(s) + (q ? `?${q}` : ""));
}

function shareUrl(s: State) {
  return `${location.origin}${path(s)}${s.build.spent ? `?b=${buildNumber(s.cls.build)}` : ""}`;
}

function asText(s: State) {
  const lines = [`${s.cls.name} ${split(s.build)} — WoW Forever ${s.cls.build}`];
  s.cls.trees.forEach((tree, ti) => {
    const picks = tree.talents
      .filter((t) => s.build.rank(t.id) > 0)
      .map((t) => `${t.name} ${s.build.rank(t.id)}/${t.ranks.length}`);
    if (picks.length) lines.push(`${tree.name} (${s.build.treePoints[ti]}): ${picks.join(", ")}`);
  });
  lines.push(shareUrl(s));
  return lines.join("\n");
}

function localStorageGet(key: string) {
  try {
    return localStorage.getItem(`ff:${key}`);
  } catch {
    return null;
  }
}

function localStorageSet(key: string, value: string) {
  try {
    localStorage.setItem(`ff:${key}`, value);
  } catch {
    /* private mode */
  }
}
