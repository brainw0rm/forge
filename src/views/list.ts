// The crafting list: recipes you plan to craft, with how many, and everything you need for them,
// either as the reagents the recipes ask for or broken down to raw materials. Kept in the browser;
// a shared link carries the whole list in its address.

import { fillAds } from "../ads";
import { craftingList, itemIcon, makersOf, qColor, reagentChip, recipeUrl, type ListEntry } from "../crafting";
import { getAllProfessions, iconUrl, type ItemRef, type Profession, type Recipe } from "../data";
import { attachItemTips } from "../itemtip";
import { openShare } from "../share";
import { copy, esc, setTitle } from "../ui";
import { rawMaterials } from "./recipe";

const HAVE_KEY = "ff-crafting-have";
const RAW_KEY = "ff-crafting-raw";

function readHave(): Set<number> {
  try {
    return new Set((JSON.parse(localStorage.getItem(HAVE_KEY) ?? "[]") as number[]).filter(Number.isFinite));
  } catch {
    return new Set();
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* not kept in private mode */
  }
}

/** "blacksmithing.2663.4,alchemy.3170.2" <-> entries */
const encode = (list: ListEntry[]) => list.map((e) => `${e.slug}.${e.spell}.${e.n}`).join(",");
function decode(s: string): ListEntry[] {
  return s
    .split(",")
    .map((part) => /^([a-z-]{2,30})\.(\d{1,8})\.(\d{1,3})$/.exec(part))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ slug: m[1], spell: Number(m[2]), n: Math.max(1, Number(m[3])) }));
}

export async function renderCraftingList(root: HTMLElement, params: URLSearchParams) {
  setTitle("Crafting list", "Plan what to craft in WoW Forever and get the full shopping list of reagents.");
  root.innerHTML = `<section class="page"><div class="loading">Opening the recipe book…</div></section>`;
  const profs = await getAllProfessions();
  const bySlug = new Map(profs.map((p) => [p.slug, p]));
  const makers = makersOf(profs);

  // A shared link: offer to replace (or merge into) the list on this device.
  const shared = params.get("r") ? decode(params.get("r")!) : [];
  let list = craftingList.get();
  const find = (e: ListEntry): { prof: Profession; r: Recipe } | null => {
    const prof = bySlug.get(e.slug);
    const r = prof?.recipes.find((x) => x.spell === e.spell);
    return prof && r ? { prof, r } : null;
  };
  let raw = (() => {
    try {
      return localStorage.getItem(RAW_KEY) === "1";
    } catch {
      return false;
    }
  })();
  const have = readHave();

  const materials = () => {
    const total = new Map<number, ItemRef>();
    for (const e of list) {
      const hit = find(e);
      if (!hit) continue;
      const items = raw ? [...rawMaterials(hit.r, e.n, makers).values()] : hit.r.reagents.map((i) => ({ ...i, count: i.count * e.n }));
      for (const i of items) {
        const t = total.get(i.id);
        if (t) t.count += i.count;
        else total.set(i.id, { ...i });
      }
    }
    return [...total.values()].sort((a, b) => Number(have.has(a.id)) - Number(have.has(b.id)) || b.count - a.count || a.name.localeCompare(b.name));
  };

  const draw = () => {
    const entries = list.map((e) => ({ e, hit: find(e) }));
    const mats = materials();
    root.innerHTML = `
      <section class="page list-page">
        <header class="page-head"><div>
          <h1>Crafting list</h1>
          <p class="lede">Add recipes from any profession, set how many, and take the shopping list with you. It stays in this browser.</p>
        </div></header>
        ${shared.length
          ? `<div class="banner"><div><strong>Someone shared a crafting list with you</strong><p class="muted">${shared.length} recipe${shared.length === 1 ? "" : "s"}.</p></div>
              <div class="banner-actions"><button class="btn primary" id="take">Use this list</button>${list.length ? `<button class="btn" id="merge">Add to mine</button>` : ""}</div></div>`
          : ""}
        ${!list.length
          ? `<div class="empty"><h3>Your crafting list is empty</h3><p>Open a profession and press <b>+ List</b> on any recipe.</p>
              <a class="btn primary" href="/professions" data-link>Browse professions</a></div>`
          : `<div class="list-layout">
          <section class="codex">
            <h2>To craft</h2>
            <ul class="craft-rows">${entries
              .map(({ e, hit }, idx) =>
                hit
                  ? `<li class="craft-row">
                      <a href="${recipeUrl(e.slug, e.spell)}" data-link class="cr-name">${hit.r.creates ? itemIcon(hit.r.creates) : `<img class="ico" src="${iconUrl(hit.prof.icon)}" alt="" />`}
                        <span><b ${hit.r.creates ? `style="--q:${qColor(hit.r.creates.q)}"` : ""}>${esc(hit.r.name)}</b><small>${esc(hit.prof.name)}${hit.r.learn ? ` (${hit.r.learn})` : ""}${hit.r.station ? ` · ${esc(hit.r.station)}` : ""}</small></span></a>
                      <div class="stepper"><button type="button" data-step="-1" data-idx="${idx}" aria-label="One fewer">−</button><input type="number" inputmode="numeric" min="1" max="999" value="${e.n}" data-idx="${idx}" aria-label="How many" /><button type="button" data-step="1" data-idx="${idx}" aria-label="One more">+</button></div>
                      <button type="button" class="icon-btn" data-remove="${idx}" aria-label="Remove ${esc(hit.r.name)}">✕</button>
                    </li>`
                  : `<li class="craft-row missing"><span>A recipe that's no longer in the game files</span><button type="button" class="icon-btn" data-remove="${idx}" aria-label="Remove">✕</button></li>`,
              )
              .join("")}</ul>
            <div class="list-actions"><button class="btn" id="share">Share list</button><button class="btn" id="copy">Copy as text</button><button class="btn ghost" id="clear">Clear</button></div>
          </section>
          <section class="codex">
            <h2>Shopping list</h2>
            <label class="switch"><input type="checkbox" id="raw" ${raw ? "checked" : ""} /> Break crafted materials down to raw materials</label>
            <ul class="mat-rows">${mats
              .map(
                (i) => `<li class="${have.has(i.id) ? "have" : ""}"><label><input type="checkbox" data-have="${i.id}" ${have.has(i.id) ? "checked" : ""} aria-label="Got ${esc(i.name)}" />
                  ${reagentChip(i)}</label>${makers.has(i.id) && !raw ? `<a class="small" href="${recipeUrl(makers.get(i.id)!.slug, makers.get(i.id)!.recipe.spell)}" data-link>craftable</a>` : ""}</li>`,
              )
              .join("")}</ul>
            <p class="muted small">Tick what you already have; ticked materials move to the bottom.</p>
          </section>
        </div>`}
      </section>`;
    wire();
  };

  const save = () => {
    craftingList.save(list);
    draw();
  };
  const wire = () => {
    attachItemTips(root);
    root.querySelector("#take")?.addEventListener("click", () => {
      list = shared.filter((e) => find(e));
      shared.length = 0;
      history.replaceState(null, "", "/list");
      save();
    });
    root.querySelector("#merge")?.addEventListener("click", () => {
      for (const e of shared.filter((x) => find(x))) {
        const mine = list.find((x) => x.slug === e.slug && x.spell === e.spell);
        if (mine) mine.n += e.n;
        else list.push(e);
      }
      shared.length = 0;
      history.replaceState(null, "", "/list");
      save();
    });
    root.querySelectorAll<HTMLButtonElement>("[data-step]").forEach((b) =>
      b.addEventListener("click", () => {
        const e = list[Number(b.dataset.idx)];
        e.n = Math.max(1, Math.min(999, e.n + Number(b.dataset.step)));
        save();
      }),
    );
    root.querySelectorAll<HTMLInputElement>(".craft-row input[data-idx]").forEach((inp) =>
      inp.addEventListener("change", () => {
        list[Number(inp.dataset.idx)].n = Math.max(1, Math.min(999, Math.round(Number(inp.value) || 1)));
        save();
      }),
    );
    root.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach((b) =>
      b.addEventListener("click", () => {
        list.splice(Number(b.dataset.remove), 1);
        save();
      }),
    );
    root.querySelector("#clear")?.addEventListener("click", () => {
      if (!confirm("Clear the whole crafting list?")) return;
      list = [];
      have.clear();
      store(HAVE_KEY, "[]");
      save();
    });
    root.querySelector<HTMLInputElement>("#raw")?.addEventListener("change", (e) => {
      raw = (e.target as HTMLInputElement).checked;
      store(RAW_KEY, raw ? "1" : "0");
      draw();
    });
    root.querySelectorAll<HTMLInputElement>("[data-have]").forEach((c) =>
      c.addEventListener("change", () => {
        const id = Number(c.dataset.have);
        if (c.checked) have.add(id);
        else have.delete(id);
        store(HAVE_KEY, JSON.stringify([...have]));
        draw();
      }),
    );
    root.querySelector("#share")?.addEventListener("click", () =>
      openShare({ url: `${location.origin}/list?r=${encode(list)}`, text: "My WoW Forever crafting list" }),
    );
    root.querySelector("#copy")?.addEventListener("click", () => {
      const lines = [
        "To craft:",
        ...list.flatMap((e) => {
          const hit = find(e);
          return hit ? [`  ${e.n}× ${hit.r.name}`] : [];
        }),
        "",
        raw ? "Raw materials:" : "Reagents:",
        ...materials().map((i) => `  ${have.has(i.id) ? "[x]" : "[ ]"} ${i.count}× ${i.name}`),
      ];
      copy(lines.join("\n"), "Shopping list copied");
    });
    fillAds(root);
  };
  draw();
}
