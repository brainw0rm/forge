// Side-by-side build comparison: one set of trees with both builds overlaid, plus a
// list of every talent that differs with its tooltip at each build's rank.

import { adSlot, fillAds } from "../ads";
import { api, type SavedBuild } from "../api";
import { Build, compareBuilds, decode, indexClass, split, type Index } from "../build";
import { classColor, getClass, getMeta, type ClassData } from "../data";
import { navigate } from "../router";
import { currentUser } from "../session";
import { copy, diffWords, esc, gameText, setTitle, toast } from "../ui";
import { treeGridHtml } from "./talents";

interface Side {
  code: string;
  saved: SavedBuild | null;
}

/** /compare/<class>/<codeA>/<codeB>  ("-" for an empty side), or /compare?a=<buildId>&b=<buildId> */
export async function renderCompare(root: HTMLElement, parts: string[], params: URLSearchParams) {
  const meta = await getMeta();
  let slug = parts[0] ?? "";
  const sides: [Side, Side] = [
    { code: parts[1] && parts[1] !== "-" ? parts[1] : "", saved: null },
    { code: parts[2] && parts[2] !== "-" ? parts[2] : "", saved: null },
  ];
  // Saved builds by id: resolve to class + code.
  for (const [i, key] of (["a", "b"] as const).entries()) {
    const id = params.get(key);
    if (!id) continue;
    const saved = await api.build(id).then((r) => r.build, () => null);
    if (saved && (!slug || saved.class === slug)) {
      slug = saved.class;
      sides[i] = { code: saved.code, saved };
    }
  }
  if (!meta.classes.some((c) => c.slug === slug)) slug = meta.classes[0].slug;
  const cls = await getClass(slug);
  const idx = indexClass(cls);
  const [a, b] = sides.map((s) => new Build(idx, cls.trees.length, decode(s.code)));
  setTitle(`Compare ${cls.name} Builds for WoW Forever`, `Compare two ${cls.name} talent builds for World of Warcraft: Forever.`);

  const diff = compareBuilds(a, b);
  const user = await currentUser();
  const [mine, top] = await Promise.all([
    user ? api.myBuilds().then((r) => r.builds.filter((x) => x.class === slug), () => []) : Promise.resolve([] as SavedBuild[]),
    api.builds({ class: slug, sort: "top" }).then((r) => r.builds, () => [] as SavedBuild[]),
  ]);

  const sideCard = (key: "a" | "b", s: Side, build: Build) => `
    <div class="cmp-side cmp-${key}">
      <div class="cmp-side-head">
        <span class="cmp-dot"></span>
        <b>${key.toUpperCase()}</b>
        <span class="cmp-title">${esc(s.saved?.title ?? (build.spent ? "Custom build" : "Empty"))}</span>
        <span class="split">${esc(split(build))}</span>
      </div>
      <p class="muted small">${build.spent} points · level ${build.level}${s.saved ? ` · by ${esc(s.saved.author)}` : ""}</p>
      <form class="cmp-pick" data-side="${key}">
        <input name="src" placeholder="Paste a build link or code" aria-label="Build ${key.toUpperCase()} link or code" />
        <select name="pick" aria-label="Choose a saved build for ${key.toUpperCase()}">
          <option value="">Choose a build…</option>
          ${mine.length ? `<optgroup label="My builds">${mine.map((m) => `<option value="${esc(m.id)}">${esc(m.title)} (${esc(m.split)})</option>`).join("")}</optgroup>` : ""}
          ${top.length ? `<optgroup label="Top community builds">${top.slice(0, 12).map((m) => `<option value="${esc(m.id)}">${esc(m.title)} (${esc(m.split)})</option>`).join("")}</optgroup>` : ""}
        </select>
        <button class="btn small">Load</button>
      </form>
      <a class="small" href="/talents/${slug}/${s.code}" data-link>Open ${key.toUpperCase()} in calculator →</a>
    </div>`;

  root.innerHTML = `
    <section class="page compare" style="--class:${classColor(slug)}">
      <header class="page-head">
        <div>
          <h1>Compare builds</h1>
          <p class="lede">Both builds on one set of ${esc(cls.name)} trees. Anything that differs is listed below, with the tooltip for each rank.</p>
        </div>
        <div class="build-head-actions">
          <button class="btn" id="swap">Swap A ↔ B</button>
          <button class="btn" id="share">Copy link</button>
        </div>
      </header>
      <nav class="class-tabs">
        ${meta.classes
          .map((c) => `<a href="/compare/${c.slug}" data-link class="${c.slug === slug ? "active" : ""}" style="--c:${classColor(c.slug)}">${esc(c.name)}</a>`)
          .join("")}
      </nav>
      <div class="cmp-sides">${sideCard("a", sides[0], a)}${sideCard("b", sides[1], b)}</div>
      <div class="cmp-summary">
        ${diff.trees
          .map(
            (t, ti) => `<div><span>${esc(cls.trees[ti].name)}</span>
              <b class="cmp-a-text">${t.a}</b> vs <b class="cmp-b-text">${t.b}</b>
              ${t.a !== t.b ? `<small>${t.b > t.a ? "+" : ""}${t.b - t.a}</small>` : ""}</div>`,
          )
          .join("")}
        <div><span>Leveling order</span>${
          diff.divergesAt ? `splits at <b>level ${diff.divergesAt}</b>` : a.spent && b.spent ? "identical so far" : "—"
        }</div>
      </div>
      <div class="cmp-legend">
        <span class="chip"><span class="swatch cmp-a-bg"></span>Only in A</span>
        <span class="chip"><span class="swatch cmp-b-bg"></span>Only in B</span>
        <span class="chip"><span class="swatch cmp-both-bg"></span>Different ranks</span>
        <span class="chip"><span class="swatch cmp-same-bg"></span>Same in both</span>
      </div>
      <div class="trees static cmp-trees">${cls.trees.map((_, ti) => compareTree(cls, idx, ti, a, b)).join("")}</div>
      ${adSlot("leaderboard")}
      <h2 class="section-title">${diff.deltas.length ? `${diff.deltas.length} talent${diff.deltas.length > 1 ? "s" : ""} differ` : "No differences"}</h2>
      <div class="diff-list">${diff.deltas.map((d) => deltaRow(cls, idx, d.id, d.a, d.b)).join("")}</div>
    </section>`;

  // Saved builds keep their id in the query, so both sides keep their title and author.
  type Pick = { code: string; id?: string };
  const current = (sd: Side): Pick => ({ code: sd.code, id: sd.saved?.id });
  const go = (next: [Pick, Pick]) => {
    const q = new URLSearchParams();
    if (next[0].id) q.set("a", next[0].id);
    if (next[1].id) q.set("b", next[1].id);
    navigate(`/compare/${slug}/${next[0].code || "-"}/${next[1].code || "-"}${q.size ? `?${q}` : ""}`, { replace: true });
  };
  root.querySelector("#swap")!.addEventListener("click", () => go([current(sides[1]), current(sides[0])]));
  root.querySelector("#share")!.addEventListener("click", () =>
    copy(`${location.origin}/compare/${slug}/${sides[0].code || "-"}/${sides[1].code || "-"}`, "Link copied"),
  );
  root.querySelectorAll<HTMLFormElement>(".cmp-pick").forEach((form) => {
    const load = async () => {
      const data = new FormData(form);
      const i = form.dataset.side === "a" ? 0 : 1;
      const picked = String(data.get("pick") ?? "");
      const code = picked
        ? await api.build(picked).then(
            (r) => r.build.code,
            () => (toast("That build couldn't be loaded."), null),
          )
        : await codeFromInput(String(data.get("src") ?? ""), slug);
      if (code === null) return;
      const next: [Pick, Pick] = [current(sides[0]), current(sides[1])];
      next[i] = { code, id: picked || undefined };
      go(next);
    };
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      load();
    });
    form.querySelector("select")!.addEventListener("change", load);
  });
  fillAds(root);
}

/** Accepts a calculator link, a /builds/<id> link, or a bare share code. Null (with a message) if invalid or empty. */
async function codeFromInput(input: string, slug: string): Promise<string | null> {
  const text = input.trim();
  if (!text) return toast("Paste a build link or code, or pick a build from the list."), null;
  const calc = /\/talents\/([a-z]+)\/([A-Za-z0-9_-]+)/.exec(text);
  if (calc) {
    if (calc[1] !== slug) {
      toast(`That link is for a different class (${calc[1]}). Both builds must be the same class.`);
      return null;
    }
    return calc[2];
  }
  const saved = /\/builds\/([A-Za-z0-9]{6,16})/.exec(text);
  if (saved) {
    const b = await api.build(saved[1]).then((r) => r.build, () => null);
    if (!b) return toast("That build doesn't exist or isn't public."), null;
    if (b.class !== slug) return toast("That build is for a different class."), null;
    return b.code;
  }
  if (/^[A-Za-z0-9_-]+$/.test(text)) return text;
  toast("Paste a Forever Forge build link or share code.");
  return null;
}

function compareTree(cls: ClassData, idx: Index, ti: number, a: Build, b: Build) {
  return treeGridHtml(cls, idx, ti, a.spent >= b.spent ? a : b, {
    interactive: false,
    points: `<span class="cmp-a-text">${a.treePoints[ti]}</span> / <span class="cmp-b-text">${b.treePoints[ti]}</span>`,
    cell: (t) => {
      const ra = a.rank(t.id);
      const rb = b.rank(t.id);
      const max = t.ranks.length;
      const kind = !ra && !rb ? "locked" : ra === rb ? "cmp-same" : !rb ? "cmp-a" : !ra ? "cmp-b" : "cmp-both";
      return {
        className: kind,
        badge: ra === rb ? `${ra}/${max}` : `<span class="cmp-a-text">${ra}</span>·<span class="cmp-b-text">${rb}</span>`,
        label: `${t.name}: A ${ra} of ${max}, B ${rb} of ${max}`,
        title: `${t.name}\nA: ${ra}/${max} · B: ${rb}/${max}`,
      };
    },
  });
}

function deltaRow(cls: ClassData, idx: Index, id: number, ra: number, rb: number) {
  const t = idx.byId.get(id)!;
  const tree = cls.trees[idx.treeOf.get(id)!].name;
  const text = (r: number) => (r ? t.ranks[r - 1] || "" : "");
  // Word diff only when both builds take the talent; otherwise plain text reads better.
  const d = ra && rb ? diffWords(text(ra), text(rb)) : { before: gameText(text(ra)), after: gameText(text(rb)) };
  return `<div class="diff-row">
      <div class="diff-name">
        <b>${esc(t.name)}</b>
        <small>${esc(tree)} · tier ${t.tier + 1}</small>
        <span class="cmp-ranks"><span class="cmp-a-text">A ${ra}/${t.ranks.length}</span> → <span class="cmp-b-text">B ${rb}/${t.ranks.length}</span></span>
      </div>
      <div class="before-after">
        <p><span class="label">A${ra ? ` · rank ${ra}` : ""}</span>${ra ? d.before : `<span class="muted">Not taken</span>`}</p>
        <p><span class="label">B${rb ? ` · rank ${rb}` : ""}</span>${rb ? d.after : `<span class="muted">Not taken</span>`}</p>
      </div>
    </div>`;
}
