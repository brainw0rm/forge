import { getMeta, getRaces, classColor } from "../data";
import { adSlot, fillAds } from "../ads";
import { esc, setTitle } from "../ui";

export async function renderRaces(root: HTMLElement) {
  const [meta, races] = await Promise.all([getMeta(), getRaces()]);
  setTitle("Race & class combinations", "Every race/class combination in World of Warcraft: Forever, with the new ones highlighted.");
  const classes = meta.classes;
  const fresh = races.reduce((n, r) => n + r.classes.filter((c) => c.status === "new").length, 0);
  const faction = (f: "alliance" | "horde", label: string) => `
    <tbody class="${f}">
      <tr class="faction-row"><th colspan="${classes.length + 1}">${label}</th></tr>
      ${races
        .filter((r) => r.faction === f)
        .map(
          (r) => `<tr>
            <th scope="row">${esc(r.name)}</th>
            ${classes
              .map((c) => {
                const combo = r.classes.find((x) => x.id === c.id);
                if (!combo) return `<td class="none"><span class="sr">not available</span></td>`;
                return combo.status === "new"
                  ? `<td class="new"><a href="/talents/${c.slug}" data-link title="${esc(r.name)} ${esc(c.name)}: new in Forever">New</a></td>`
                  : `<td class="yes"><span aria-label="available">●</span></td>`;
              })
              .join("")}
          </tr>`,
        )
        .join("")}
    </tbody>`;

  root.innerHTML = `
    <section class="page">
      <h1>Race &amp; class combinations</h1>
      <p class="lede"><b>${fresh}</b> combinations are new compared with Classic Era, read from the game client's character creation data.</p>
      <div class="matrix-wrap">
        <table class="matrix">
          <thead><tr><th></th>${classes
            .map((c) => `<th scope="col" style="--class:${classColor(c.slug)}"><a href="/talents/${c.slug}" data-link>${esc(c.name)}</a></th>`)
            .join("")}</tr></thead>
          ${faction("alliance", "Alliance")}
          ${faction("horde", "Horde")}
        </table>
      </div>
      ${adSlot("leaderboard")}
      <div class="lore">
        ${races
          .filter((r) => r.classes.every((c) => c.status === "new"))
          .map((r) => `<article><h2>${esc(r.name)}</h2><p>${esc(r.lore)}</p></article>`)
          .join("")}
      </div>
    </section>`;
  fillAds(root);
}
