import { adSlot, fillAds } from "../ads";
import { api, type SavedBuild } from "../api";
import { decode } from "../build";
import { buildNumber, classColor, getChangelog, getClass, getMeta } from "../data";
import { busy, formError, openModal } from "../modal";
import { navigate } from "../router";
import { currentUser, loginUrl } from "../session";
import { LIMITS, REPORT_REASON_LABEL, REPORT_REASONS } from "../../shared/validate";
import { copy, esc, setTitle, toast } from "../ui";
import { watchButtonHtml, wireWatchButton } from "../watch";
import { describeChange, staticTreesHtml } from "./talents";

const dateFmt = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });
const date = (ms: number) => dateFmt.format(new Date(ms));

export function stars(avg: number, count: number): string {
  const full = Math.round(avg * 2) / 2;
  const icons = [1, 2, 3, 4, 5]
    .map((i) => `<span class="star ${full >= i ? "on" : full >= i - 0.5 ? "half" : ""}">★</span>`)
    .join("");
  return `<span class="stars" aria-label="${count ? `${avg.toFixed(1)} out of 5, ${count} rating${count > 1 ? "s" : ""}` : "No ratings yet"}">
      ${icons}<span class="stars-meta">${count ? `${avg.toFixed(1)} <small>(${count})</small>` : "<small>No ratings</small>"}</span>
    </span>`;
}

export function buildCard(b: SavedBuild, className: string, opts: { showAuthor?: boolean } = {}): string {
  return `<a class="build-card" href="/builds/${esc(b.id)}" data-link style="--class:${classColor(b.class)}">
      <div class="build-card-top">
        <span class="class-pill">${esc(className)}</span>
        <span class="split">${esc(b.split)}</span>
        ${b.isPublic ? "" : `<span class="private-pill">Private</span>`}
        ${b.hidden ? `<span class="private-pill hidden-pill">Hidden</span>` : ""}
      </div>
      <h3>${esc(b.title)}</h3>
      ${b.description ? `<p class="build-desc">${esc(b.description)}</p>` : ""}
      <div class="build-card-foot">
        ${stars(b.rating.avg, b.rating.count)}
        <span class="muted small">${opts.showAuthor === false ? "" : `by ${esc(b.author)} · `}${date(b.updatedAt)}</span>
      </div>
    </a>`;
}

// ---------------------------------------------------------------- browse

export async function renderBuildList(root: HTMLElement, params: URLSearchParams) {
  const meta = await getMeta();
  const cls = params.get("class") ?? "";
  const sort = params.get("sort") === "new" ? "new" : "top";
  const q = params.get("q") ?? "";
  const names = new Map(meta.classes.map((c) => [c.slug, c.name]));
  setTitle("Community builds", "Top-rated World of Warcraft: Forever talent builds from the community.");

  root.innerHTML = `
    <section class="page">
      <header class="page-head">
        <div>
          <h1>Community builds</h1>
          <p class="lede">Builds other players saved and shared. Found a good one? Give it some stars.</p>
        </div>
        <a class="btn primary" href="/talents/${cls || "warrior"}" data-link>Create a build</a>
      </header>
      <form class="filters" role="search">
        <div class="seg" role="group" aria-label="Class">
          <a href="${listUrl({ sort, q })}" data-link class="${cls ? "" : "active"}">All classes</a>
          ${meta.classes
            .map(
              (c) =>
                `<a href="${listUrl({ class: c.slug, sort, q })}" data-link class="${c.slug === cls ? "active" : ""}" style="--c:${classColor(c.slug)}">${esc(c.name)}</a>`,
            )
            .join("")}
        </div>
        <div class="filter-row">
          <input type="search" name="q" value="${esc(q)}" placeholder="Search titles and descriptions" aria-label="Search builds" />
          <select name="sort" aria-label="Sort">
            <option value="top" ${sort === "top" ? "selected" : ""}>Top rated</option>
            <option value="new" ${sort === "new" ? "selected" : ""}>Newest</option>
          </select>
        </div>
      </form>
      <div class="with-rail">
        <div>
          <div class="build-grid" id="results"><p class="muted">Loading builds…</p></div>
          <div class="more" id="more"></div>
          ${adSlot("leaderboard", "stack-only")}
        </div>
        <aside class="rail">${adSlot("rail", "wide-only")}</aside>
      </div>
    </section>`;

  const form = root.querySelector<HTMLFormElement>(".filters")!;
  const apply = () => {
    const data = new FormData(form);
    navigate(listUrl({ class: cls, sort: String(data.get("sort")), q: String(data.get("q") ?? "").trim() }), { replace: true });
  };
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    apply();
  });
  form.querySelector("select")!.addEventListener("change", apply);
  fillAds(root);

  const results = root.querySelector<HTMLElement>("#results")!;
  const more = root.querySelector<HTMLElement>("#more")!;
  let page = 1;
  let shown = 0;
  const load = async () => {
    try {
      const res = await api.builds({ class: cls, sort, q, page });
      if (page === 1) results.innerHTML = "";
      res.builds.forEach((b) => {
        results.insertAdjacentHTML("beforeend", buildCard(b, names.get(b.class) ?? b.class));
        // An in-feed ad after every 9th build.
        if (++shown % 9 === 0) results.insertAdjacentHTML("beforeend", adSlot("rectangle", "in-feed"));
      });
      if (!shown) {
        results.innerHTML = `<div class="empty">
            <h3>No builds yet${cls ? ` for ${esc(names.get(cls) ?? cls)}` : ""}</h3>
            <p>Be the first: make a build in the calculator and press <b>Save build</b>.</p>
            <a class="btn primary" href="/talents/${cls || "warrior"}" data-link>Open the calculator</a>
          </div>`;
      }
      more.innerHTML = res.hasMore ? `<button class="btn">Load more</button>` : "";
      more.querySelector("button")?.addEventListener("click", () => {
        page++;
        load();
      });
      fillAds(results);
    } catch (err) {
      results.innerHTML = `<div class="empty"><h3>Couldn't load builds</h3><p>${esc((err as Error).message)}</p></div>`;
    }
  };
  load();
}

function listUrl(p: { class?: string; sort?: string; q?: string }) {
  const qs = new URLSearchParams();
  if (p.class) qs.set("class", p.class);
  if (p.sort && p.sort !== "top") qs.set("sort", p.sort);
  if (p.q) qs.set("q", p.q);
  const s = qs.toString();
  return `/builds${s ? `?${s}` : ""}`;
}

// ---------------------------------------------------------------- detail

export async function renderBuildDetail(root: HTMLElement, id: string) {
  let build: SavedBuild;
  try {
    build = (await api.build(id)).build;
  } catch (err) {
    setTitle("Build not found");
    root.innerHTML = `<section class="page"><div class="empty"><h1>Build not found</h1>
        <p>${esc((err as Error).message)}</p><a class="btn" href="/builds" data-link>Browse builds</a></div></section>`;
    return;
  }
  const [cls, user, log] = await Promise.all([getClass(build.class), currentUser(), getChangelog()]);
  const isAdmin = user?.role === "admin";
  setTitle(build.title, `${cls.name} ${build.split} build by ${build.author} for World of Warcraft: Forever.`);
  const order = decode(build.code);
  const calcUrl = `/talents/${build.class}/${build.code}?b=${build.gameBuild}`;
  const changes = log
    .filter((e) => buildNumber(e.build) > build.gameBuild)
    .flatMap((e) => e.changes)
    .filter((c) => c.class === build.class && order.includes(c.talent));

  const draw = () => {
    root.innerHTML = `
      <section class="page build-page" style="--class:${classColor(build.class)}">
        <nav class="crumbs"><a href="/builds" data-link>Community builds</a> / <a href="/builds?class=${build.class}" data-link>${esc(cls.name)}</a></nav>
        <header class="build-head">
          <div>
            <span class="class-pill">${esc(cls.name)}</span>
            <h1>${esc(build.title)}</h1>
            <p class="muted">by <b>${esc(build.author)}</b> · updated ${date(build.updatedAt)} · build ${build.gameBuild}
              ${build.isPublic ? "" : ` · <span class="private-pill">Private</span>`}</p>
          </div>
          <div class="build-head-actions">
            <a class="btn primary" href="${calcUrl}" data-link>Open in calculator</a>
            <button class="btn" id="share">Copy link</button>
            <a class="btn" href="/compare?a=${build.id}" data-link>Compare</a>
            ${build.isPublic || build.mine ? watchButtonHtml("Watch") : ""}
            ${
              build.mine
                ? `<a class="btn" href="/talents/${build.class}/${build.code}?edit=${build.id}" data-link>Edit</a>
                   <button class="btn ghost danger" id="delete">Delete</button>`
                : user && build.isPublic
                  ? `<button class="btn ghost" id="report" ${build.reported ? "disabled" : ""}>${build.reported ? "Reported" : "Report"}</button>`
                  : ""
            }
          </div>
        </header>
        ${
          build.hidden
            ? `<div class="banner warn"><div><strong>Hidden pending review</strong>
                <p class="muted">${
                  build.mine
                    ? "Several players reported this build, so it's hidden from everyone else until a moderator reviews it."
                    : "Only you (as a moderator) and its author can see this build."
                }</p></div></div>`
            : ""
        }
        ${
          isAdmin
            ? `<div class="mod-bar"><span>Moderation</span>
                ${build.hidden ? `<button class="btn small" data-mod="unhide">Unhide</button>` : `<button class="btn small" data-mod="hide">Hide</button>`}
                ${build.openReports ? `<button class="btn small" data-mod="dismiss">Dismiss ${build.openReports} report${build.openReports === 1 ? "" : "s"}</button>` : ""}
                <button class="btn small danger" data-mod="delete">Delete build</button>
                <a href="/admin" data-link class="small">Open queue →</a></div>`
            : ""
        }
        ${
          changes.length
            ? `<div class="banner warn"><div><strong>${changes.length} talent${changes.length > 1 ? "s" : ""} in this build changed since it was saved</strong>
                <ul>${changes.map((c) => `<li><b>${esc(c.name)}</b>: ${esc(describeChange(c))}</li>`).join("")}</ul></div></div>`
            : ""
        }
        <div class="with-rail">
          <div class="build-main">
            <div class="build-facts">
              <div><span>Point split</span><b>${esc(build.split)}</b></div>
              <div><span>Points</span><b>${build.points}/51</b></div>
              <div><span>Rating</span>${stars(build.rating.avg, build.rating.count)}</div>
            </div>
            ${build.description ? `<div class="build-description">${paragraphs(build.description)}</div>` : ""}
            <div class="trees static">${staticTreesHtml(cls, order)}</div>
          </div>
          <aside class="rail">
            <div class="rate-card" id="rate">${rateCard()}</div>
            ${adSlot("rectangle")}
          </aside>
        </div>
      </section>`;
    wire();
    fillAds(root);
  };

  const rateCard = () => {
    if (build.mine) return `<h3>Ratings</h3><p class="muted">You can't rate your own build. Share it to collect ratings.</p>`;
    if (!user)
      return `<h3>Rate this build</h3><p class="muted">Sign in to rate builds.</p>
        <a class="btn block" href="${loginUrl()}" data-link>Sign in</a>`;
    if (!user.emailVerified)
      return `<h3>Rate this build</h3><p class="muted">Confirm your email address to rate builds.</p>
        <a class="btn block" href="/account" data-link>Resend confirmation</a>`;
    if (!build.isPublic || build.hidden) return `<h3>Ratings</h3><p class="muted">This build can't be rated right now.</p>`;
    return `<h3>${build.myRating ? "Your rating" : "Rate this build"}</h3>
      <div class="rate-input" role="radiogroup" aria-label="Your rating">
        ${[1, 2, 3, 4, 5]
          .map(
            (i) =>
              `<button role="radio" aria-checked="${build.myRating === i}" data-stars="${i}" class="${(build.myRating ?? 0) >= i ? "on" : ""}" aria-label="${i} star${i > 1 ? "s" : ""}">★</button>`,
          )
          .join("")}
      </div>
      ${build.myRating ? `<button class="link-btn" id="unrate">Remove my rating</button>` : ""}`;
  };

  const wire = () => {
    root.querySelector("#share")!.addEventListener("click", () => copy(`${location.origin}/builds/${build.id}`, "Link copied"));
    wireWatchButton(root.querySelector("[data-watch]"), "build", build.id, "Watch");
    root.querySelectorAll<HTMLButtonElement>("[data-stars]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        try {
          build = (await api.rate(build.id, Number(btn.dataset.stars))).build;
          toast("Thanks for rating!");
          draw();
        } catch (err) {
          toast((err as Error).message);
        }
      }),
    );
    root.querySelector("#unrate")?.addEventListener("click", async () => {
      build = (await api.unrate(build.id)).build;
      draw();
    });
    root.querySelector("#delete")?.addEventListener("click", () => confirmDelete(build));
    root.querySelector("#report")?.addEventListener("click", () =>
      reportBuild(build, () => {
        build = { ...build, reported: true };
        draw();
      }),
    );
    root.querySelectorAll<HTMLButtonElement>("[data-mod]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const action = btn.dataset.mod as "dismiss" | "hide" | "unhide" | "delete";
        if (action === "delete" && !confirm(`Delete “${build.title}” permanently?`)) return;
        try {
          await api.moderate(build.id, action);
          toast(action === "delete" ? "Build deleted" : "Done");
          if (action === "delete") return navigate("/admin");
          build = (await api.build(build.id)).build;
          draw();
        } catch (err) {
          toast((err as Error).message);
        }
      }),
    );
  };

  draw();
}

function paragraphs(text: string) {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function confirmDelete(build: SavedBuild, after: () => void = () => navigate("/account")) {
  const dlg = openModal(
    "Delete build?",
    `<form class="form"><p>“${esc(build.title)}” and its ratings will be deleted. This can't be undone.</p>
      <div class="form-actions">
        <button type="button" class="btn ghost" data-close>Cancel</button>
        <button type="submit" class="btn danger">Delete build</button>
      </div></form>`,
  );
  const form = dlg.querySelector("form")!;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector<HTMLButtonElement>("button[type=submit]");
    busy(btn, true, "Deleting…");
    try {
      await api.deleteBuild(build.id);
      dlg.close();
      toast("Build deleted");
      after();
    } catch (err) {
      busy(btn, false);
      formError(form, (err as Error).message);
    }
  });
}

function reportBuild(build: SavedBuild, done: () => void) {
  const dlg = openModal(
    "Report build",
    `<form class="form" novalidate>
      <p>Tell the moderators what's wrong with “${esc(build.title)}”. Builds reported by several players are hidden until reviewed.</p>
      <fieldset class="radio-list">
        <legend class="sr">Reason</legend>
        ${REPORT_REASONS.map(
          (r, i) => `<label class="radio"><input type="radio" name="reason" value="${r}" ${i === 0 ? "checked" : ""} /> ${REPORT_REASON_LABEL[r]}</label>`,
        ).join("")}
      </fieldset>
      <label><span>Details <span class="optional">(optional)</span></span>
        <textarea name="details" rows="3" maxlength="${LIMITS.reportDetails}" placeholder="Anything that helps a moderator decide"></textarea>
      </label>
      <div class="form-actions">
        <button type="button" class="btn ghost" data-close>Cancel</button>
        <button type="submit" class="btn primary">Send report</button>
      </div>
    </form>`,
  );
  const form = dlg.querySelector("form")!;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const btn = form.querySelector<HTMLButtonElement>("button[type=submit]");
    busy(btn, true, "Sending…");
    try {
      await api.report(build.id, String(data.get("reason")), String(data.get("details") ?? "").trim());
      dlg.close();
      toast("Thanks. A moderator will take a look.");
      done();
    } catch (err) {
      busy(btn, false);
      formError(form, (err as Error).message);
    }
  });
}
