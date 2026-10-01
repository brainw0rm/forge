import "@fontsource-variable/inter";
import "@fontsource/marcellus";
import "./style.css";
import { loadAdScript } from "./ads";
import { openBugReport } from "./feedback";
import { getMeta, iconUrl } from "./data";
import { currentUser, onUserChange } from "./session";
import { esc, setTitle } from "./ui";
import { renderAccount } from "./views/account";
import { renderAdmin } from "./views/admin";
import { logout, renderForgot, renderLogin, renderReset, renderSignup, renderVerify } from "./views/auth";
import { renderBuildDetail, renderBuildList } from "./views/builds";
import { renderChanges } from "./views/changes";
import { renderCompare } from "./views/compare";
import { renderGear } from "./views/gear";
import { renderHome } from "./views/home";
import { renderItem, renderItemList } from "./views/items";
import { renderLegacy } from "./views/legacy";
import { renderLeveling } from "./views/leveling";
import { renderNews } from "./views/news";
import { renderImprint, renderPrivacy, renderUnsubscribe } from "./views/legal";
import { api } from "./api";
import { renderProfessions } from "./views/professions";
import { renderRaces } from "./views/races";
import { renderTalents } from "./views/talents";
import type { User } from "./api";


const app = document.getElementById("app")!;

async function route() {
  const parts = location.pathname.split("/").filter(Boolean);
  const params = new URLSearchParams(location.search);
  const tools = ["compare", "leveling", "legacy", "gear", "professions"];
  document.querySelector(".nav-menu")?.classList.toggle("active", tools.includes(parts[0] ?? ""));
  document.querySelectorAll<HTMLAnchorElement>(".site-nav > a").forEach((a) => {
    const section = a.getAttribute("href")!.split("/")[1];
    a.classList.toggle("active", section === (parts[0] ?? ""));
    if (a.classList.contains("active")) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  closeMenu();
  document.body.classList.toggle("is-home", !parts[0]);
  currentUser().then(renderAuthArea); // refresh "next" links for the new page
  setTitle(""); // views set their own; this keeps a stale title from sticking on pages that don't
  try {
    const meta = await getMeta();
    switch (parts[0]) {
      case undefined:
        return await renderHome(app);
      case "talents": {
        const slug = meta.classes.some((c) => c.slug === parts[1]) ? parts[1] : meta.classes[0].slug;
        // Unknown class in the link: show the default class under its real address.
        if (parts[1] && slug !== parts[1]) history.replaceState(null, "", `/talents/${slug}${location.search}`);
        return await renderTalents(app, slug, parts[2] ?? "", params);
      }
      case "builds":
        return parts[1] ? await renderBuildDetail(app, parts[1]) : await renderBuildList(app, params);
      case "gear":
        return await renderGear(app, parts[1] ?? "", params);
      case "professions":
        return await renderProfessions(app, parts[1] ?? "", params);
      case "legacy":
        return await renderLegacy(app, parts[1] ?? "");
      case "leveling":
        return await renderLeveling(app, parts.slice(1));
      case "compare":
        return await renderCompare(app, parts.slice(1), params);
      case "changes":
        return await renderChanges(app, parts[1] ?? "", parts[2] ?? "");
      case "races":
        return await renderRaces(app);
      case "items":
        return /^\d+$/.test(parts[1] ?? "") ? await renderItem(app, Number(parts[1])) : await renderItemList(app, params);
      case "news":
        return await renderNews(app, params);
      case "login":
        return await renderLogin(app, params);
      case "signup":
        return await renderSignup(app, params);
      case "account":
        return await renderAccount(app);
      case "forgot-password":
        return renderForgot(app);
      case "reset-password":
        return renderReset(app, params);
      case "verify-email":
        return await renderVerify(app, params);
      case "admin":
        return await renderAdmin(app);
      case "privacy":
        return renderPrivacy(app);
      case "unsubscribe":
        return renderUnsubscribe(app, params, api.unsubscribe);
      case "imprint":
        return renderImprint(app);
      default:
        setTitle("Page not found");
        app.innerHTML = `<section class="page"><div class="empty"><h1>Page not found</h1>
          <p>That page doesn't exist.</p><a class="btn" href="/" data-link>Go home</a></div></section>`;
    }
  } catch (err) {
    app.innerHTML = `<section class="page"><div class="empty"><h1>Something went wrong</h1><p>${esc(String(err))}</p></div></section>`;
    throw err;
  }
}

function renderAuthArea(user: User | null) {
  const el = document.getElementById("auth-area")!;
  const next = encodeURIComponent(location.pathname + location.search);
  el.innerHTML = user
    ? `<details class="user-menu">
        <summary><span class="avatar" aria-hidden="true">${esc(user.username[0].toUpperCase())}</span><span class="user-name">${esc(user.username)}</span></summary>
        <div class="menu">
          <a href="/account" data-link>My builds</a>
          <a href="/talents" data-link>New build</a>
          ${user.role === "admin" ? `<a href="/admin" data-link>Moderation</a>` : ""}
          ${user.emailVerified ? "" : `<a href="/account" data-link class="menu-warn">Confirm your email</a>`}
          <button type="button" id="logout">Sign out</button>
        </div>
      </details>`
    : `<a class="btn ghost small" href="/login?next=${next}" data-link>Sign in</a>
       <a class="btn primary small" href="/signup?next=${next}" data-link>Create account</a>`;
  el.querySelector("#logout")?.addEventListener("click", logout);
  // Phones: "Create account" lives in the menu when signed out (see .nav-signup in style.css).
  document.querySelector(".site-nav .nav-signup")?.remove();
  if (!user) {
    document.getElementById("site-nav")!.insertAdjacentHTML("beforeend", `<a class="nav-signup" href="/signup?next=${next}" data-link>Create account</a>`);
  }
}

function closeMenu() {
  document.body.classList.remove("menu-open");
  document.getElementById("menu-toggle")?.setAttribute("aria-expanded", "false");
  document.querySelectorAll<HTMLDetailsElement>(".user-menu, .nav-menu").forEach((d) => d.removeAttribute("open"));
}

document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (!target.closest(".user-menu")) document.querySelector<HTMLDetailsElement>(".user-menu")?.removeAttribute("open");
  if (!target.closest(".nav-menu")) document.querySelector<HTMLDetailsElement>(".nav-menu")?.removeAttribute("open");
  // Close "More" menus after picking an item or clicking elsewhere.
  document.querySelectorAll<HTMLDetailsElement>(".more-menu[open]").forEach((d) => {
    if (!d.contains(target) || target.closest(".menu")) d.removeAttribute("open");
  });
  const bug = target.closest<HTMLElement>("[data-report-bug]");
  if (bug) {
    closeMenu();
    openBugReport(bug.dataset.kind);
    return;
  }
  const a = target.closest<HTMLAnchorElement>("a[data-link]");
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  if (a.href !== location.href) history.pushState(null, "", a.href);
  show();
});
/** Render the current URL, then focus the page's [autofocus] field (the attribute only works on initial load). */
async function show() {
  await route();
  window.scrollTo(0, 0);
  app.querySelector<HTMLElement>("[autofocus]")?.focus();
}

window.addEventListener("popstate", route);
window.addEventListener("ff:navigate", show);

document.getElementById("menu-toggle")!.addEventListener("click", () => {
  const open = document.body.classList.toggle("menu-open");
  document.getElementById("menu-toggle")!.setAttribute("aria-expanded", String(open));
});

getMeta().then((m) => {
  document.getElementById("build-badge")!.textContent = `${m.phase === "live" ? "Live" : "Beta"} ${m.build.split(".").pop()}`;
});
currentUser().then(renderAuthArea);
onUserChange(renderAuthArea);
loadAdScript();
// Some Forever icons aren't on Blizzard's public icon server yet: show the "?" icon instead of a broken image.
document.addEventListener(
  "error",
  (e) => {
    const img = e.target;
    if (img instanceof HTMLImageElement && img.src.includes("/icons/") && !img.src.includes("inv_misc_questionmark")) {
      img.src = iconUrl("inv_misc_questionmark");
    }
  },
  true,
);
show();
