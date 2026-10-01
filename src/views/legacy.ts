// Legacy planner: spend the account-wide Legacy points across the three Legacy trees.

import { adSlot, fillAds } from "../ads";
import { decode, encode } from "../build";
import { getLegacy, iconUrl, type LegacyData, type LegacyNode } from "../data";
import { LegacyPlan } from "../legacy";
import { copy, esc, gameText, setTitle } from "../ui";

const COLS = 4;
const ROWS = 4;
const STEP = 64;
const CELL = 48;

export async function renderLegacy(root: HTMLElement, code: string) {
  const data = await getLegacy();
  setTitle("WoW Forever Legacy Planner", "Plan your account-wide Legacy points in World of Warcraft: Forever.");
  let plan = new LegacyPlan(data, decode(code));
  let focus: number | null = null;

  root.innerHTML = `
    <section class="page legacy">
      <header class="page-head">
        <div>
          <h1>Legacy planner</h1>
          <p class="lede">You earn Legacy points once per account, and the bonuses apply to all your characters.
            You can spend up to <b>${data.cap}</b> points.</p>
        </div>
        <div class="build-head-actions">
          <button class="btn" id="copy">Copy link</button>
          <button class="btn ghost" id="reset">Reset</button>
        </div>
      </header>
      <div class="legacy-status" id="status"></div>
      <div class="legacy-layout">
        <div class="legacy-trees" id="trees"></div>
        <aside class="legacy-detail" id="detail" aria-live="polite"></aside>
      </div>
      <p class="data-note">Nodes, ranks, requirements and the ${data.cap}-point cap come from the game client. The client doesn't name the
        three trees; the names here describe what's in them. Slots marked “future update” are placeholders in the client.</p>
      ${adSlot("leaderboard")}
      <h2 class="section-title">How to earn Legacy points</h2>
      <input type="search" id="source-q" placeholder="Search requirements, e.g. “Warrior”, “Onyxia”, “Honor”" aria-label="Search Legacy point sources" />
      <div class="source-groups" id="sources"></div>
    </section>`;

  const draw = () => {
    history.replaceState(null, "", `/legacy${plan.spent ? `/${encode(plan.order)}` : ""}`);
    root.querySelector("#status")!.innerHTML = `
      <div><span>Points spent</span><b>${plan.spent}<small>/${data.cap}</small></b></div>
      ${data.trees.map((t, ti) => `<div><span>${esc(t.label)}</span><b>${plan.treeSpent(ti)}</b></div>`).join("")}`;
    root.querySelector("#trees")!.innerHTML = data.trees.map((_, ti) => treeHtml(data, plan, ti)).join("");
    root.querySelectorAll<HTMLButtonElement>(".legacy-node").forEach((el) => {
      const id = Number(el.dataset.id);
      el.addEventListener("click", (e) => {
        plan = e.shiftKey ? plan.remove(id) : plan.add(id);
        focus = id;
        draw();
      });
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        plan = plan.remove(id);
        focus = id;
        draw();
      });
      el.addEventListener("mouseenter", () => {
        focus = id;
        drawDetail();
      });
      el.addEventListener("focus", () => {
        focus = id;
        drawDetail();
      });
    });
    drawDetail();
  };

  const drawDetail = () => {
    const el = root.querySelector<HTMLElement>("#detail")!;
    const node = focus !== null ? plan.node(focus) : null;
    if (!node) {
      el.innerHTML = `<h3>Pick a bonus</h3><p class="muted">Hover a bonus to read it. Click to spend a point, right-click (or shift-click) to take it back.</p>`;
      return;
    }
    const opt = node.options[0];
    const r = plan.rank(node.id);
    const blocker = plan.addBlocker(node.id);
    el.innerHTML = `
      <header><img src="${iconUrl(opt.icon)}" alt="" /><div><h3>${esc(opt.name)}</h3><span class="muted small">Rank ${r}/${opt.ranks.length}</span></div></header>
      ${node.placeholder ? `<p class="muted">${esc(opt.ranks[0])}</p>` : ""}
      ${!node.placeholder && r > 0 ? `<p class="tt-text">${gameText(opt.ranks[r - 1])}</p>` : ""}
      ${!node.placeholder && r < opt.ranks.length ? `${r > 0 ? `<div class="tt-sub">Next rank</div>` : ""}<p class="tt-text">${gameText(opt.ranks[r])}</p>` : ""}
      ${blocker && blocker !== "Max rank" && !node.placeholder ? `<p class="req">${esc(blocker)}</p>` : ""}`;
  };

  root.querySelector("#copy")!.addEventListener("click", () => copy(location.href, "Link copied"));
  root.querySelector("#reset")!.addEventListener("click", () => {
    plan = new LegacyPlan(data);
    draw();
  });

  const sources = groupSources(data);
  const drawSources = (q: string) => {
    const needle = q.trim().toLowerCase();
    root.querySelector("#sources")!.innerHTML = sources
      .map((g) => {
        const items = g.items.filter((i) => !needle || i.text.toLowerCase().includes(needle));
        if (!items.length) return "";
        return `<section class="source-group"><h3>${esc(g.title)} <span>${items.length}</span></h3>
          <ul>${items.map((i) => `<li>${esc(i.text)}${i.amount > 1 ? ` <b>+${i.amount}</b>` : ""}</li>`).join("")}</ul></section>`;
      })
      .join("") || `<p class="muted">No requirements match “${esc(q)}”.</p>`;
  };
  root.querySelector<HTMLInputElement>("#source-q")!.addEventListener("input", (e) => drawSources((e.target as HTMLInputElement).value));
  drawSources("");
  draw();
  fillAds(root);
}

function treeHtml(data: LegacyData, plan: LegacyPlan, ti: number) {
  const tree = data.trees[ti];
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const center = (n: LegacyNode) => [n.col * STEP + STEP / 2, n.row * STEP + STEP / 2];
  const arrows = tree.nodes
    .filter((n) => n.prereq !== null && byId.has(n.prereq))
    .map((n) => {
      const p = byId.get(n.prereq!)!;
      const [px, py] = center(p);
      const [x, y] = center(n);
      const half = CELL / 2;
      const d = p.row === n.row ? `M${px + Math.sign(x - px) * half} ${py} H${x - Math.sign(x - px) * (half + 4)}` : `M${px} ${py + half} V${y - half - 4}`;
      const lit = plan.rank(p.id) >= plan.maxRank(p.id);
      return `<path d="${d}" class="${lit ? "lit" : ""}"/>`;
    })
    .join("");
  const cells = tree.nodes
    .map((n) => {
      const r = plan.rank(n.id);
      const max = plan.maxRank(n.id);
      const state = n.placeholder ? "placeholder" : r >= max ? "maxed" : r > 0 ? "partial" : plan.canAdd(n.id) ? "open" : "locked";
      const left = ((n.col * STEP + (STEP - CELL) / 2) / (COLS * STEP)) * 100;
      const top = ((n.row * STEP + (STEP - CELL) / 2) / (ROWS * STEP)) * 100;
      return `<button class="talent legacy-node ${state}" data-id="${n.id}" style="left:${left}%;top:${top}%"
          aria-label="${esc(n.options[0].name)}, rank ${r} of ${max}" ${n.placeholder ? "aria-disabled=\"true\"" : ""}>
          <img src="${iconUrl(n.options[0].icon)}" alt="" loading="lazy" />
          <span class="rank">${n.placeholder ? "—" : `${r}/${max}`}</span>
        </button>`;
    })
    .join("");
  return `<article class="tree legacy-tree">
      <header><h2>${esc(tree.label)}</h2><span class="tree-points">${plan.treeSpent(ti)}</span></header>
      <div class="grid legacy-grid">
        <svg class="arrows" viewBox="0 0 ${COLS * STEP} ${ROWS * STEP}" aria-hidden="true">${arrows}</svg>
        ${cells}
      </div>
    </article>`;
}

/** Group the client's requirement strings into readable sections (duplicates are faction variants). */
function groupSources(data: LegacyData) {
  const groups = new Map<string, Map<string, { text: string; amount: number }>>();
  const titleFor = (t: string) =>
    /^Reach Level/i.test(t) ? "Leveling milestones" : /Honor|Field of Honor|battleground|Warsong|Arathi|Alterac/i.test(t) ? "PvP" : /^Complete|raid|dungeon/i.test(t) ? "Dungeons & raids" : "Other";
  for (const s of data.sources) {
    const title = titleFor(s.requirement);
    const g = groups.get(title) ?? new Map();
    if (!g.has(s.requirement)) g.set(s.requirement, { text: s.requirement, amount: s.amount });
    groups.set(title, g);
  }
  const order = ["Leveling milestones", "Dungeons & raids", "PvP", "Other"];
  return order.filter((t) => groups.has(t)).map((title) => ({ title, items: [...groups.get(title)!.values()] }));
}
