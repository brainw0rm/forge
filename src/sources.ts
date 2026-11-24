// Where a recipe comes from: what players report for WoW Forever (approved by the operator), and
// Classic Era's drops, vendors, quests and trainers from the open-source CMaNGOS database, labeled as
// such since Forever may differ. The game client itself carries none of this.

import { api, type ReportedSource, type SourceKind } from "./api";
import { type ClassicSourceFile, type ClassicSources, type RecipeItem } from "./data";
import { busy, formError, openModal } from "./modal";
import { esc, toast } from "./ui";

export const CLASSIC_DB_URL = "https://github.com/cmangos/classic-db";

const KINDS: [SourceKind, string][] = [
  ["drop", "Dropped by a creature"],
  ["vendor", "Sold by a vendor"],
  ["quest", "Quest reward"],
  ["trainer", "Taught by a trainer"],
  ["container", "Found in a chest or container"],
  ["other", "Somewhere else"],
];
const KIND_LABEL: Record<SourceKind, string> = { drop: "Drop", vendor: "Vendor", quest: "Quest", trainer: "Trainer", container: "Container", other: "Other" };

export function money(copper: number) {
  const g = Math.floor(copper / 10000);
  const s = Math.floor(copper / 100) % 100;
  const c = copper % 100;
  return [g && `<span class="coin gold">${g}</span>`, s && `<span class="coin silver">${s}</span>`, (c || (!g && !s)) && `<span class="coin copper">${c}</span>`]
    .filter(Boolean)
    .join(" ");
}

const where = (zones: string[]) => (zones.length ? `<span class="src-where">${zones.map(esc).join(" · ")}</span>` : "");
const faction = (f?: string) => (f ? ` <span class="src-faction ${f.toLowerCase()}">${f}</span>` : "");
const chance = (p: number) => `<span class="src-chance">${p < 0.01 ? "<0.01" : p}%</span>`;

/** Classic Era sources of one recipe item, or "" when the database has none. */
export function classicSourcesHtml(s: ClassicSources | undefined) {
  if (!s) return "";
  const rows: string[] = [];
  for (const v of s.vendors ?? []) {
    rows.push(`<li><span class="src-kind">Vendor</span><span class="src-main"><b>${esc(v.n)}</b>${v.sub ? ` <small>&lt;${esc(v.sub)}&gt;</small>` : ""}${faction(v.faction)}
      ${where(v.zones)}${v.limited ? `<small class="src-note">limited supply</small>` : ""}</span></li>`);
  }
  for (const q of s.quests ?? []) {
    rows.push(`<li><span class="src-kind">Quest</span><span class="src-main"><b>${esc(q.t)}</b> <small>level ${q.lvl}</small>${faction(q.faction)}
      ${q.zone ? where([q.zone]) : ""}</span></li>`);
  }
  for (const d of s.drops ?? []) {
    rows.push(`<li><span class="src-kind">Drop</span><span class="src-main"><b>${esc(d.n)}</b> <small>level ${esc(d.lvl)}${d.rank ? ` ${esc(d.rank)}` : ""}</small>
      ${where(d.zones)}</span>${chance(d.chance)}</li>`);
  }
  if (s.moreDrops) rows.push(`<li class="src-more">…and ${s.moreDrops} more creature${s.moreDrops === 1 ? "" : "s"} with lower chances</li>`);
  if (s.world) {
    rows.push(`<li><span class="src-kind">World drop</span><span class="src-main"><b>${s.world.creatures} creatures</b> <small>level ${s.world.lvl[0]}–${s.world.lvl[1]}</small>
      <span class="src-where">anywhere they live</span></span><span class="src-chance">${s.world.chance[0]}–${s.world.chance[1]}%</span></li>`);
  }
  for (const o of s.objects ?? []) {
    rows.push(`<li><span class="src-kind">Container</span><span class="src-main"><b>${esc(o.n)}</b>${where(o.zones)}</span>${chance(o.chance)}</li>`);
  }
  return rows.length ? `<ul class="src-list">${rows.join("")}</ul>` : "";
}

/** The Classic Era block for a recipe: its trainer and every recipe item's sources. */
export function classicBlock(file: ClassicSourceFile, spell: number, items: RecipeItem[]) {
  const trainer = file.trainers[String(spell)];
  const perItem = items
    .map((i) => ({ i, html: classicSourcesHtml(file.items[String(i.id)]) }))
    .filter((x) => x.html)
    .map(({ i, html }) => (items.length > 1 ? `<h3 class="src-item">${esc(i.name)}</h3>${html}` : html))
    .join("");
  if (!trainer && !perItem) return "";
  return `<div class="src-classic">
      <p class="src-label"><span class="tag tag-classic">Classic Era</span> Community data; WoW Forever may differ.</p>
      ${trainer ? `<ul class="src-list"><li><span class="src-kind">Trainer</span><span class="src-main"><b>Profession trainers</b> <small>at skill ${trainer.skill}</small></span>${
        trainer.cost ? `<span class="src-chance">${money(trainer.cost)}</span>` : ""
      }</li></ul>` : ""}
      ${perItem}
      <p class="muted small">Drop chances, vendors, quests and trainers as the open-source
        <a href="${CLASSIC_DB_URL}" rel="noopener" target="_blank">CMaNGOS Classic database</a> (GPL v3) records them for Classic Era.
        Blizzard doesn't publish them, and the game files don't contain them.</p>
    </div>`;
}

/** Approved player reports for WoW Forever. */
export function reportedHtml(list: ReportedSource[]) {
  if (!list.length) return `<p class="muted small">No player reports for WoW Forever yet. Found it somewhere? Tell us below.</p>`;
  return `<ul class="src-list">${list
    .map(
      (r) => `<li><span class="src-kind">${KIND_LABEL[r.kind]}</span><span class="src-main"><b>${esc(r.place)}</b>${r.zone ? where([r.zone]) : ""}</span>
        <span class="src-chance">${r.reports} player${r.reports === 1 ? "" : "s"}</span></li>`,
    )
    .join("")}</ul>`;
}

/** "Where did you find it?" form. */
export function openSourceReport(prof: string, spell: number, recipeName: string, onSent: () => void) {
  const dlg = openModal(
    "Where did you find it?",
    `<form class="form" novalidate>
      <p>Tell other players where you got <b>${esc(recipeName)}</b> in WoW Forever. It shows on this page once it's checked.</p>
      <fieldset class="radio-list">
        <legend class="sr">Where did it come from?</legend>
        ${KINDS.map(
          ([id, label], i) => `<label class="radio"><input type="radio" name="kind" value="${id}" ${i === 0 ? "checked" : ""} /><span><b>${label}</b></span></label>`,
        ).join("")}
      </fieldset>
      <label>Who or where <input name="place" required minlength="2" maxlength="80" placeholder="e.g. Borya, or Scarlet Monastery" /></label>
      <label>Zone <span class="optional">(optional)</span><input name="zone" maxlength="60" placeholder="e.g. Orgrimmar" /></label>
      <label>Anything else <span class="optional">(optional)</span><textarea name="note" maxlength="300" rows="2" placeholder="Price, how rare, which faction…"></textarea></label>
      <label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off" /></label>
      <p class="fine">Reports are anonymous. We store what you write and the date; nothing else.</p>
      <div class="form-actions">
        <button type="button" class="btn ghost" data-close>Cancel</button>
        <button class="btn primary">Send</button>
      </div>
    </form>`,
  );
  const form = dlg.querySelector("form")!;
  form.querySelector<HTMLInputElement>("input[name=place]")!.focus();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const place = String(data.get("place") ?? "").trim();
    if (place.length < 2) return formError(form, "Please say who or where.");
    const button = form.querySelector<HTMLButtonElement>(".btn.primary");
    busy(button, true, "Sending…");
    try {
      await api.sendSource({
        prof,
        spell,
        kind: String(data.get("kind")) as SourceKind,
        place,
        zone: String(data.get("zone") ?? "").trim(),
        note: String(data.get("note") ?? "").trim(),
        website: String(data.get("website") ?? ""),
      });
      dlg.close();
      toast("Thanks! It shows here once it's checked.");
      onSent();
    } catch (err) {
      busy(button, false);
      formError(form, (err as Error).message);
    }
  });
}
