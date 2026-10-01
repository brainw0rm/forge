import { api } from "../api";
import { classColor, getMeta } from "../data";
import { navigate } from "../router";
import { currentUser, loginUrl } from "../session";
import { REPORT_REASON_LABEL } from "../../shared/validate";
import { esc, setTitle, toast } from "../ui";

const dateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export async function renderAdmin(root: HTMLElement) {
  const user = await currentUser();
  if (!user) return navigate(loginUrl("/admin"), { replace: true });
  setTitle("Moderation");
  if (user.role !== "admin") {
    root.innerHTML = `<section class="page"><div class="empty"><h1>Moderators only</h1>
      <p>This page is for Forever Forge moderators.</p><a class="btn" href="/" data-link>Go home</a></div></section>`;
    return;
  }
  const [meta, { queue }, news, { reports }] = await Promise.all([getMeta(), api.moderationQueue(), api.adminNews(), api.openFeedback()]);
  const hiddenNews = news.items.filter((h) => h.hidden);
  const names = new Map(meta.classes.map((c) => [c.slug, c.name]));

  root.innerHTML = `
    <section class="page">
      <header class="page-head">
        <div>
          <h1>Moderation</h1>
          <p class="lede">Reported builds, most reported first. A build is hidden automatically once three players report it.</p>
        </div>
      </header>
      ${
        queue.length
          ? `<div class="mod-queue">${queue
              .map(
                ({ build: b, reports }) => `<article class="mod-item" data-id="${esc(b.id)}" style="--class:${classColor(b.class)}">
                  <header>
                    <div>
                      <span class="class-pill">${esc(names.get(b.class) ?? b.class)}</span>
                      ${b.hidden ? `<span class="private-pill hidden-pill">Hidden</span>` : ""}
                      <h3><a href="/builds/${esc(b.id)}" data-link>${esc(b.title)}</a></h3>
                      <p class="muted small">by ${esc(b.author)} · ${reports.length} open report${reports.length === 1 ? "" : "s"}</p>
                    </div>
                    <div class="mod-actions">
                      <button class="btn small" data-mod="dismiss">Dismiss</button>
                      ${b.hidden ? `<button class="btn small" data-mod="unhide">Unhide</button>` : `<button class="btn small" data-mod="hide">Hide</button>`}
                      <button class="btn small danger" data-mod="delete">Delete</button>
                    </div>
                  </header>
                  ${b.description ? `<p class="mod-desc">${esc(b.description)}</p>` : ""}
                  ${
                    reports.length
                      ? `<ul class="report-list">${reports
                          .map(
                            (r) => `<li><b>${esc(REPORT_REASON_LABEL[r.reason as keyof typeof REPORT_REASON_LABEL] ?? r.reason)}</b>
                              <span class="muted small">· ${esc(r.reporter)} · ${dateFmt.format(new Date(r.createdAt))}</span>
                              ${r.details ? `<p>${esc(r.details)}</p>` : ""}</li>`,
                          )
                          .join("")}</ul>`
                      : `<p class="muted small">No open reports; hidden by a moderator.</p>`
                  }
                </article>`,
              )
              .join("")}</div>`
          : `<div class="empty"><h3>All clear</h3><p>No reported or hidden builds right now.</p></div>`
      }
      <h2 class="group-title">Bug reports <span>${reports.length} open</span></h2>
      ${
        reports.length
          ? `<div class="mod-queue">${reports
              .map(
                (r) => `<article class="mod-item feedback-item" data-feedback="${r.id}">
                  <header>
                    <div>
                      <span class="badge ${r.kind === "data" ? "st-reworked" : r.kind === "idea" ? "st-new" : "st-tuned"}">${{ bug: "Bug", data: "Wrong data", idea: "Idea" }[r.kind]}</span>
                      <p class="muted small"><a href="${esc(r.page)}" data-link>${esc(r.page)}</a> · ${esc(r.username ?? "signed out")}${
                        r.email ? ` · <a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : ""
                      } · ${dateFmt.format(new Date(r.createdAt))}</p>
                    </div>
                    <div class="mod-actions"><button class="btn small" data-resolve>Mark resolved</button></div>
                  </header>
                  <p class="mod-desc">${esc(r.message)}</p>
                  <p class="fine muted">${esc([r.context.screen, r.context.build, r.context.browser].filter(Boolean).join(" · "))}</p>
                </article>`,
              )
              .join("")}</div>`
          : `<p class="muted small">No open bug reports.</p>`
      }
      <h2 class="group-title">Hidden news headlines <span>${hiddenNews.length}</span></h2>
      ${
        hiddenNews.length
          ? `<ul class="watch-list">${hiddenNews
              .map(
                (h) => `<li><a href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.title)}</a>
                  <span class="muted small">${esc(h.source)}</span>
                  <button class="btn small" data-unhide-news="${esc(h.url)}">Unhide</button></li>`,
              )
              .join("")}</ul>`
          : `<p class="muted small">None. Hide a headline from the News page (for example on a publisher's request); hidden headlines are never shown again unless you unhide them here.</p>`
      }
    </section>`;

  root.querySelectorAll<HTMLButtonElement>("[data-resolve]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const item = btn.closest<HTMLElement>("[data-feedback]")!;
      btn.disabled = true;
      try {
        await api.resolveFeedback(Number(item.dataset.feedback));
        toast("Report resolved");
        renderAdmin(root);
      } catch (err) {
        btn.disabled = false;
        toast((err as Error).message);
      }
    }),
  );
  root.querySelectorAll<HTMLButtonElement>("[data-unhide-news]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await api.setNewsHidden(btn.dataset.unhideNews!, false);
        toast("Headline visible again");
        renderAdmin(root);
      } catch (err) {
        btn.disabled = false;
        toast((err as Error).message);
      }
    }),
  );

  root.querySelectorAll<HTMLButtonElement>("[data-mod]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const item = btn.closest<HTMLElement>(".mod-item")!;
      const action = btn.dataset.mod as "dismiss" | "hide" | "unhide" | "delete";
      if (action === "delete" && !confirm("Delete this build permanently?")) return;
      btn.disabled = true;
      try {
        await api.moderate(item.dataset.id!, action);
        toast({ dismiss: "Reports dismissed", hide: "Build hidden", unhide: "Build visible again", delete: "Build deleted" }[action]);
        renderAdmin(root);
      } catch (err) {
        btn.disabled = false;
        toast((err as Error).message);
      }
    }),
  );
}
