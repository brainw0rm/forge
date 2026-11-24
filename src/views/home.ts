// Home: search every recipe at once, every profession, and what the site can do for a crafter.

import { adSlot, fillAds } from "../ads";
import { itemIcon, qColor, recipeUrl } from "../crafting";
import { getAllProfessions, getMeta, getProfessions, iconUrl, type Profession } from "../data";
import { attachItemTips } from "../itemtip";
import { esc, setTitle } from "../ui";
import { professionGrid } from "./professions";

const MAX_HITS = 30;

export async function renderHome(root: HTMLElement) {
  setTitle("", "Every crafting recipe in WoW Forever from the game files: reagents, skill-up colors, tools, recipe items and what changed since Classic Era.");
  const [list, meta] = await Promise.all([getProfessions(), getMeta()]);
  const total = list.reduce((n, p) => n + p.recipes, 0);
  const fresh = list.reduce((n, p) => n + p.new, 0);
  const changed = list.reduce((n, p) => n + p.changed, 0);

  root.innerHTML = `
    <section class="home">
      <header class="forge-hero">
        <div class="hero-emblem" aria-hidden="true">${document.querySelector(".logo-mark")?.outerHTML.replace('class="logo-mark"', "") ?? ""}</div>
        <p class="eyebrow">WoW Forever crafting companion</p>
        <h1>Every recipe.<br /><span class="gold-title">Every reagent.</span></h1>
        <p class="lede">All ${total.toLocaleString("en")} crafting recipes of WoW Forever, read straight from the game files: reagents, skill-up colors, tools, stations, recipe items, and what changed since Classic Era.</p>
        <div class="hero-search">
          <input type="search" id="search" placeholder="Search recipes, results or reagents…" aria-label="Search all recipes" autocomplete="off" />
        </div>
        <dl class="hero-numbers">
          <div><dt>Recipes</dt><dd>${total.toLocaleString("en")}</dd></div>
          <div><dt>New in Forever</dt><dd>${fresh.toLocaleString("en")}</dd></div>
          <div><dt>Changed from Classic</dt><dd>${changed.toLocaleString("en")}</dd></div>
        </dl>
      </header>
      <div id="hits" aria-live="polite"></div>
      <div class="wow-window book">
        <img class="win-portrait" src="/favicon.svg" alt="" />
        <header class="win-title"><h2>Professions</h2></header>
        <div class="win-pad">${professionGrid(list)}</div>
      </div>
      <section class="features">
        <a class="feature" href="/professions/tailoring" data-link>
          <b>Skill-up colors at your skill</b>
          <span>Enter your skill on a profession page: every recipe shows orange, yellow, green or grey, like the profession window.</span>
        </a>
        <a class="feature" href="/list" data-link>
          <b>Crafting list</b>
          <span>Collect what you want to craft and get the shopping list, crafted materials broken down to ore, herbs and cloth.</span>
        </a>
        <a class="feature" href="/professions/leatherworking?show=changed" data-link>
          <b>Changed since Classic</b>
          <span>New reagents, new skill ranges, new recipes: every difference to Classic Era ${esc(meta.classicBuild)} is marked.</span>
        </a>
      </section>
      ${adSlot("leaderboard")}
      <p class="data-note">Data from the ${meta.phase === "live" ? "game client" : "beta client"}, build ${esc(meta.build)}, updated when a new build appears.
        Where recipe items drop or who sells them isn't in the client data, so it isn't here either.</p>
    </section>`;
  attachItemTips(root);
  fillAds(root);

  let profs: Profession[] | null = null;
  const hits = root.querySelector<HTMLElement>("#hits")!;
  const input = root.querySelector<HTMLInputElement>("#search")!;
  const search = async () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) {
      hits.innerHTML = "";
      return;
    }
    profs ??= await getAllProfessions();
    if (input.value.trim().toLowerCase() !== q) return; // typed on while loading
    const found = profs.flatMap((p) =>
      p.recipes
        .filter((r) => r.name.toLowerCase().includes(q) || !!r.creates?.name.toLowerCase().includes(q) || r.reagents.some((i) => i.name.toLowerCase().includes(q)))
        .map((r) => ({ p, r, exact: r.name.toLowerCase().startsWith(q) })),
    );
    found.sort((a, b) => Number(b.exact) - Number(a.exact) || a.r.name.localeCompare(b.r.name));
    hits.innerHTML = `<section class="codex search-hits">
        <h2>${found.length ? `${found.length} recipe${found.length === 1 ? "" : "s"}` : "No recipes"} for “${esc(input.value.trim())}”</h2>
        <ul>${found
          .slice(0, MAX_HITS)
          .map(
            ({ p, r }) => `<li><a href="${recipeUrl(p.slug, r.spell)}" data-link>
              ${r.creates ? itemIcon(r.creates) : `<img class="ico" src="${iconUrl(p.icon)}" alt="" />`}
              <span><b ${r.creates ? `style="--q:${qColor(r.creates.q)}"` : ""}>${esc(r.name)}</b><small>${esc(p.name)}${r.learn ? ` · skill ${r.learn}` : ""}${r.new ? " · new" : ""}</small></span></a></li>`,
          )
          .join("")}</ul>
        ${found.length > MAX_HITS ? `<p class="muted small">Showing the first ${MAX_HITS}. Search inside a profession for more.</p>` : ""}
        <p class="small"><a href="/items?search=${encodeURIComponent(input.value.trim())}" data-link>Search all items for “${esc(input.value.trim())}”</a></p>
      </section>`;
  };
  input.addEventListener("input", search);
}
