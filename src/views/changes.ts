import { buildLabel, getChangelog, getClass, getMeta, iconUrl, STATUS_LABEL, type ClassData, type Talent, classColor } from "../data";
import { adSlot, fillAds, withListAds, withRail } from "../ads";
import { diffWords, esc, gameText, setTitle } from "../ui";
import { describeChange } from "./talents";

/** /changes            -> build-by-build changelog
 *  /changes/classic/x  -> Classic Era vs Forever for one class */
export async function renderChanges(root: HTMLElement, mode: string, slug: string) {
  const meta = await getMeta();
  const active = slug || meta.classes[0].slug;
  const tabs = `
    <nav class="subnav">
      <a href="/changes" data-link class="${mode !== "classic" ? "active" : ""}">Build changelog</a>
      <a href="/changes/classic/${active}" data-link class="${mode === "classic" ? "active" : ""}">Classic Era → Forever</a>
    </nav>`;
  if (mode === "classic") return renderClassicDiff(root, tabs, active);

  setTitle("Build changelog", "Talent changes between World of Warcraft: Forever game builds, from the beta to the live game.");
  const log = await getChangelog();
  const byClass = new Map(meta.classes.map((c) => [c.slug, c]));
  root.innerHTML = `
    <section class="page">
      <h1>What changed</h1>
      ${tabs}
      <p class="lede">Whenever a new game build comes out, we compare its talents with the one before. Builds that changed nothing are listed too, so you can see we checked.</p>
      ${adSlot("leaderboard", "narrow-only")}
      ${withRail(`<div class="changelog">
        ${log
          .map(
            (e) => `<article class="build">
              <header><h2>Build ${esc(e.build)}</h2><span>vs ${esc(e.previous)}</span>
                <span class="count">${e.changes.length ? `${e.changes.length} talent change${e.changes.length > 1 ? "s" : ""}` : "No talent changes"}</span></header>
              ${withListAds(
                e.changes,
                (c) => {
                  const cls = byClass.get(c.class);
                  const diff = diffWords(c.before ?? "", c.after ?? "");
                  return `<div class="change">
                      <div class="change-head">
                        <a href="/talents/${c.class}" data-link class="cls" style="--class:${classColor(c.class)}">${esc(cls?.name ?? c.class)}</a>
                        <b>${esc(c.name)}</b><span class="kind">${esc(describeChange(c))}</span>
                      </div>
                      ${
                        c.type === "changed" && c.kinds?.includes("text")
                          ? `<div class="before-after"><p>${diff.before}</p><p>${diff.after}</p></div>`
                          : c.after || c.before
                            ? `<p class="plain">${esc(c.after ?? c.before ?? "")}</p>`
                            : ""
                      }
                    </div>`;
                },
                8,
              )}
            </article>`,
          )
          .join("")}
      </div>`)}
    </section>`;
  fillAds(root);
}

async function renderClassicDiff(root: HTMLElement, tabs: string, slug: string) {
  const [meta, cls] = await Promise.all([getMeta(), getClass(slug)]);
  setTitle(`${cls.name}: Classic vs Forever`, `Every ${cls.name} talent that changed between Classic Era and WoW Forever.`);
  const groups: { title: string; filter: (t: Talent) => boolean }[] = [
    { title: "New talents", filter: (t) => t.status === "new" },
    { title: "Reworked", filter: (t) => t.status === "reworked" },
    { title: "Expanded: same effect, plus more", filter: (t) => t.status === "expanded" },
    { title: "Tuned numbers", filter: (t) => t.status === "tuned" },
    {
      title: "Reworded only: same effect and numbers",
      filter: (t) => (t.status === "unchanged" || t.status === "moved") && !!(t.reason || t.notes?.includes("reworded")),
    },
    { title: "Not in the game client yet", filter: (t) => t.status === "unverified" },
  ];
  root.innerHTML = `
    <section class="page" style="--class:${classColor(cls.slug)}">
      <h1>Classic Era → Forever</h1>
      ${tabs}
      <nav class="class-tabs">
        ${meta.classes
          .map(
            (c) =>
              `<a href="/changes/classic/${c.slug}" data-link class="${c.slug === slug ? "active" : ""}" style="--c:${classColor(c.slug)}">${esc(c.name)}</a>`,
          )
          .join("")}
      </nav>
      <p class="lede">Rank 1 of each talent, Classic Era ${esc(cls.classicBuild)} next to Forever ${esc(buildLabel(meta, cls.build))}, with the changed words marked.
        <a href="/talents/${slug}?lens=1" data-link>See it in the calculator →</a></p>
      ${adSlot("leaderboard", "narrow-only")}
      ${withRail(`${withListAds(
        groups.map((g) => group(cls, g.title, g.filter)).filter(Boolean),
        (html) => html,
        2,
      )}
      ${
        cls.removed.length
          ? `<h2 class="group-title">Gone from the trees <span>${cls.removed.length}</span></h2>
             <div class="diff-list">${cls.removed
               .map(
                 (r) => `<div class="diff-row removed-row"><div class="diff-name"><b>${esc(r.name)}</b><small>${esc(r.tree)}</small></div>
                    <p>${gameText(r.ranks[r.ranks.length - 1] || r.ranks[0])}</p></div>`,
               )
               .join("")}</div>`
          : ""
      }`)}
    </section>`;
  fillAds(root);
}

function group(cls: ClassData, title: string, filter: (t: Talent) => boolean) {
  const rows = cls.trees.flatMap((tree) => tree.talents.filter(filter).map((t) => ({ tree: tree.name, t })));
  if (!rows.length) return "";
  return `<h2 class="group-title">${esc(title)} <span>${rows.length}</span></h2>
    <div class="diff-list">${rows
      .map(({ tree, t }) => {
        const d = diffWords(t.classic?.ranks[0] ?? "", t.ranks[0] ?? "");
        const replaced = t.notes?.includes("replaces");
        return `<div class="diff-row">
            <div class="diff-name">
              <img src="${iconUrl(t.icon)}" alt="" loading="lazy" />
              <b>${esc(t.name)}</b>
              <small>${esc(tree)} · tier ${t.tier + 1} · ${t.ranks.length} rank${t.ranks.length > 1 ? "s" : ""}</small>
              <span class="badge st-${t.status}">${STATUS_LABEL[t.status]}</span>
            </div>
            ${
              t.classic && !replaced
                ? `<div class="before-after">
                    <p><span class="label">Classic${t.classic.name !== t.name ? ` · ${esc(t.classic.name)}` : ""}</span>${d.before}</p>
                    <p><span class="label">Forever</span>${d.after}</p></div>`
                : `<div class="before-after single">
                    ${replaced ? `<p><span class="label">Replaces · ${esc(t.classic!.name)}</span>${esc(t.classic!.ranks[0])}</p>` : ""}
                    <p><span class="label">Forever</span>${gameText(t.ranks[0])}</p></div>`
            }
            ${t.reason ? `<p class="diff-reason">${esc(t.reason)}</p>` : ""}
          </div>`;
      })
      .join("")}</div>`;
}
