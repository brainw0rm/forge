// Home page hero: a live build preview that plays a real build point by point, a quick search over
// talents, items and classes, a class picker and counting stats. Everything shown is real game data.

import { decode as decodeOrder } from "../../shared/code";
import type { SavedBuild } from "../api";
import { Build, indexClass, split, type Index } from "../build";
import { classColor, getClass, iconUrl, isLive, QUALITY_COLOR, RELEASE_DATE, type ClassData, type Meta } from "../data";
import { getItemIndex } from "../itemdb";
import { navigate } from "../router";
import { esc } from "../ui";
import { stars } from "./builds";
import { playbackTreeHtml } from "./talents";

const STEP_MS = 260;
const HOLD_MS = 3200;
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface HeroStats {
  talents: number;
  changed: number;
  items: number;
  builds: number;
}

interface Featured {
  cls: ClassData;
  idx: Index;
  order: number[];
  tree: number;
  saved: SavedBuild | null;
}

/** The top community build, or (before anyone has published one) an example build filled tier by tier. */
async function featuredBuild(meta: Meta, top: SavedBuild[]): Promise<Featured> {
  const saved = top.find((b) => b.points >= 15) ?? top[0] ?? null;
  const slug = saved?.class ?? meta.classes[Math.floor(Date.now() / 86_400_000) % meta.classes.length].slug;
  const cls = await getClass(slug);
  const idx = indexClass(cls);
  let order: number[];
  if (saved) {
    order = new Build(idx, cls.trees.length, decodeOrder(saved.code)).order;
  } else {
    // Greedy example: fill one tree lowest tier first, respecting tier gates and prerequisites.
    const ti = Math.floor(Date.now() / 86_400_000) % cls.trees.length;
    const talents = [...cls.trees[ti].talents].sort((a, b) => a.tier - b.tier || a.col - b.col);
    let b = new Build(idx, cls.trees.length, []);
    for (let guard = 0; guard < 200 && b.spent < 31; guard++) {
      const next = talents.find((t) => b.canAdd(t.id));
      if (!next) break;
      b = b.add(next.id);
    }
    order = b.order;
  }
  const full = new Build(idx, cls.trees.length, order);
  const tree = full.treePoints.indexOf(Math.max(...full.treePoints));
  return { cls, idx, order, tree, saved };
}


export function heroHtml(meta: Meta, stats: HeroStats): string {
  return `
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow hero-live"><span class="live-dot" aria-hidden="true"></span>${isLive(meta) ? "Live game data" : "Live beta data"} · build ${esc(meta.build.split(".").pop()!)}</p>
        <h1>Plan your Forever build from <span class="hero-accent">the actual game files</span></h1>
        <p class="lede">We pull the talents and items out of the game client itself and check each new build against Classic Era
          and the build before it. Make a build, share it, and see what other people are running.</p>
        ${
          isLive(meta)
            ? ""
            : `<p class="hero-launch"><b>Beta data for now.</b> Forever launches on
                ${RELEASE_DATE.toLocaleDateString(undefined, { month: "long", day: "numeric", timeZone: "UTC" })} and we switch to the live game as soon
                as it's out. If Blizzard changes talents at launch, your saved builds will tell you which ones.</p>`
        }
        <div class="hero-search">
          <input id="hero-q" type="search" autocomplete="off" spellcheck="false" placeholder="Search talents, items and classes"
            role="combobox" aria-expanded="false" aria-controls="hero-results" aria-autocomplete="list" aria-label="Search talents, items and classes" />
          <kbd aria-hidden="true">/</kbd>
          <div class="hero-results" id="hero-results" role="listbox" hidden></div>
        </div>
        <nav class="hero-classes" aria-label="Open the calculator for a class">
          ${meta.classes
            .map(
              (c) => `<a href="/talents/${c.slug}" data-link style="--class:${classColor(c.slug)}" title="${esc(c.name)}">
                <img src="${iconUrl(`classicon_${c.slug}`)}" alt="" /><span>${esc(c.name)}</span></a>`,
            )
            .join("")}
        </nav>
        <dl class="hero-numbers">
          <div><dt>Talents</dt><dd data-count="${stats.talents}">${stats.talents}</dd></div>
          <div><dt>Changed vs Classic</dt><dd data-count="${stats.changed}">${stats.changed}</dd></div>
          <div><dt>Items</dt><dd data-count="${stats.items}">${stats.items.toLocaleString()}</dd></div>
          <div><dt>Builds diffed</dt><dd data-count="${stats.builds}">${stats.builds}</dd></div>
        </dl>
      </div>
      <aside class="hero-showcase" id="hero-showcase" aria-label="Featured build"><div class="showcase-loading"></div></aside>
    </section>`;
}

export async function wireHero(root: HTMLElement, meta: Meta, top: SavedBuild[]) {
  countUp(root);
  wireSearch(root, meta);
  const card = root.querySelector<HTMLElement>("#hero-showcase")!;
  const f = await featuredBuild(meta, top).catch(() => null);
  if (!f || !card.isConnected) return;
  const color = classColor(f.cls.slug);
  const full = new Build(f.idx, f.cls.trees.length, f.order);
  const title = f.saved ? esc(f.saved.title) : `Example ${esc(f.cls.trees[f.tree].name)} ${esc(f.cls.name)}`;
  const link = f.saved ? `/builds/${esc(f.saved.id)}` : `/talents/${f.cls.slug}`;
  card.style.setProperty("--class", color);
  card.innerHTML = `
    <header class="showcase-head">
      <span class="class-pill">${esc(f.cls.name)}</span>
      <a class="showcase-title" href="${link}" data-link>${title}</a>
      <p class="muted small">${
        f.saved
          ? `by ${esc(f.saved.author)} · ${esc(f.saved.split)}${f.saved.rating.count ? ` · ${stars(f.saved.rating.avg, f.saved.rating.count)}` : ""}`
          : `A sample build filled tier by tier · ${esc(split(full))}`
      }</p>
    </header>
    <div class="showcase-tree trees static" id="showcase-tree">${playbackTreeHtml(f.cls, f.idx, f.tree, reducedMotion() ? full : new Build(f.idx, f.cls.trees.length, []))}</div>
    <footer class="showcase-foot">
      <span class="showcase-level"><b id="showcase-points">${reducedMotion() ? full.spent : 0}</b> points · level <b id="showcase-level">${reducedMotion() ? full.level : 1}</b></span>
      <a class="btn small" href="${f.saved ? `/talents/${f.cls.slug}/${f.saved.code}` : `/talents/${f.cls.slug}`}" data-link>Open in calculator</a>
    </footer>`;
  if (!reducedMotion()) play(card, f);
}

/** Spends the featured build's points one by one, holds, and starts over while the card is visible. */
function play(card: HTMLElement, f: Featured) {
  const host = card.querySelector<HTMLElement>("#showcase-tree")!;
  const tpl = document.createElement("template");
  let step = 0;
  let visible = true;
  const observer = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
  observer.observe(card);
  const tick = () => {
    if (!card.isConnected) return observer.disconnect();
    if (!visible || document.hidden) return void setTimeout(tick, 500);
    if (step > f.order.length) step = 0;
    const b = new Build(f.idx, f.cls.trees.length, f.order.slice(0, step));
    tpl.innerHTML = playbackTreeHtml(f.cls, f.idx, f.tree, b);
    // Update classes, badges and arrows in place so the icons don't reload and flicker.
    const next = tpl.content;
    host.querySelectorAll<HTMLElement>(".talent").forEach((el) => {
      const n = next.querySelector<HTMLElement>(`.talent[data-id="${el.dataset.id}"]`);
      if (!n) return;
      const placed = step > 0 && f.order[step - 1] === Number(el.dataset.id);
      el.className = n.className + (placed ? " just-placed" : "");
      el.querySelector(".rank")!.innerHTML = n.querySelector(".rank")!.innerHTML;
    });
    host.querySelector(".arrows")!.innerHTML = next.querySelector(".arrows")!.innerHTML;
    host.querySelector(".tree-points")!.textContent = next.querySelector(".tree-points")!.textContent;
    card.querySelector("#showcase-points")!.textContent = String(b.spent);
    card.querySelector("#showcase-level")!.textContent = String(b.level);
    step++;
    setTimeout(tick, step > f.order.length ? HOLD_MS : STEP_MS);
  };
  setTimeout(tick, 600);
}

function countUp(root: HTMLElement) {
  if (reducedMotion()) return;
  const els = [...root.querySelectorAll<HTMLElement>(".hero-numbers dd[data-count]")];
  const start = performance.now();
  const frame = (now: number) => {
    const p = Math.min(1, (now - start) / 1100);
    const eased = 1 - Math.pow(1 - p, 3);
    for (const el of els) el.textContent = Math.round(Number(el.dataset.count) * eased).toLocaleString();
    if (p < 1 && root.isConnected) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ search

interface Hit {
  html: string;
  href: string;
}

let talentIndex: Promise<{ id: number; name: string; lower: string; cls: string; tree: string; icon: string; status: string }[]> | null = null;

function loadTalents(meta: Meta) {
  talentIndex ??= Promise.all(meta.classes.map((c) => getClass(c.slug))).then((all) =>
    all.flatMap((cls) =>
      cls.trees.flatMap((tree) =>
        tree.talents.map((t) => ({ id: t.id, name: t.name, lower: t.name.toLowerCase(), cls: cls.slug, tree: tree.name, icon: t.icon, status: t.status })),
      ),
    ),
  );
  return talentIndex;
}

function wireSearch(root: HTMLElement, meta: Meta) {
  const input = root.querySelector<HTMLInputElement>("#hero-q")!;
  const box = root.querySelector<HTMLElement>("#hero-results")!;
  const names = new Map(meta.classes.map((c) => [c.slug, c.name]));
  let hits: Hit[] = [];
  let active = -1;
  let timer = 0;

  const close = () => {
    box.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  };
  const highlight = (i: number) => {
    active = i;
    box.querySelectorAll<HTMLElement>("[role=option]").forEach((el, k) => el.setAttribute("aria-selected", String(k === i)));
    if (i >= 0) {
      input.setAttribute("aria-activedescendant", `hero-hit-${i}`);
      box.querySelector(`#hero-hit-${i}`)?.scrollIntoView({ block: "nearest" });
    }
  };

  const run = async () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) return close();
    const words = q.split(/\s+/);
    const match = (s: string) => words.every((w) => s.includes(w));
    const [talents, items] = await Promise.all([loadTalents(meta), getItemIndex().then((i) => i.rows)]);
    if (input.value.trim().toLowerCase() !== q) return; // a newer search is running
    const classHits = meta.classes.filter((c) => match(c.name.toLowerCase()));
    const talentHits = talents.filter((t) => match(t.lower)).slice(0, 5);
    const itemHits = items.filter((r) => match(r.lower)).slice(0, 6);
    const group = (label: string, list: Hit[]) => (list.length ? [{ html: `<div class="hr-group" role="presentation">${label}</div>`, href: "" }, ...list] : []);
    hits = [
      ...group(
        "Classes",
        classHits.map((c) => ({
          href: `/talents/${c.slug}`,
          html: `<img src="${iconUrl(`classicon_${c.slug}`)}" alt="" /><span style="color:${classColor(c.slug)}">${esc(c.name)}</span><small>Talent calculator</small>`,
        })),
      ),
      ...group(
        "Talents",
        talentHits.map((t) => ({
          href: `/talents/${t.cls}?t=${t.id}`,
          html: `<img src="${iconUrl(t.icon)}" alt="" /><span>${esc(t.name)}</span><small style="color:${classColor(t.cls)}">${esc(names.get(t.cls) ?? t.cls)} · ${esc(t.tree)}</small>`,
        })),
      ),
      ...group(
        "Items",
        itemHits.map((r) => ({
          href: `/items/${r.id}`,
          html: `<img src="${iconUrl(r.icon)}" alt="" /><span style="color:${QUALITY_COLOR[r.q] ?? QUALITY_COLOR[1]}">${esc(r.name)}</span><small>item level ${r.ilvl}</small>`,
        })),
      ),
      { href: `/items?search=${encodeURIComponent(input.value.trim())}`, html: `<span class="hr-all">Search all items for “${esc(input.value.trim())}” →</span>` },
    ];
    let n = 0;
    box.innerHTML = hits
      .map((h) => (h.href ? `<a class="hr-hit" role="option" id="hero-hit-${n++}" href="${h.href}" data-link aria-selected="false">${h.html}</a>` : h.html))
      .join("");
    hits = hits.filter((h) => h.href);
    box.hidden = false;
    input.setAttribute("aria-expanded", "true");
    highlight(-1);
  };

  input.addEventListener("focus", () => {
    loadTalents(meta);
    getItemIndex();
    if (input.value.trim().length >= 2) run();
  });
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = window.setTimeout(run, 90);
  });
  input.addEventListener("keydown", (e) => {
    if (box.hidden) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      highlight((active + (e.key === "ArrowDown" ? 1 : hits.length - 1) + (active < 0 && e.key === "ArrowUp" ? 1 : 0)) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = hits[active >= 0 ? active : 0];
      if (hit) navigate(hit.href);
    } else if (e.key === "Escape") {
      close();
    }
  });
  input.addEventListener("blur", () => setTimeout(close, 150));

  // "/" focuses the search from anywhere on the home page.
  const onSlash = (e: KeyboardEvent) => {
    if (!input.isConnected) return document.removeEventListener("keydown", onSlash);
    const target = e.target as HTMLElement;
    if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(target.tagName) && !target.isContentEditable) {
      e.preventDefault();
      input.focus();
    }
  };
  document.addEventListener("keydown", onSlash);
}
