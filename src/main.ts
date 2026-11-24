import "@fontsource-variable/inter";
import "@fontsource/marcellus";
import "./style.css";
import { loadAdScript } from "./ads";
import { openBugReport } from "./feedback";
import { craftingList } from "./crafting";
import { getMeta, iconUrl } from "./data";
import { showSupportLinks } from "./support";
import { esc, setTitle } from "./ui";
import { renderHome } from "./views/home";
import { renderItem, renderItemList } from "./views/items";
import { renderImprint, renderPrivacy } from "./views/legal";
import { renderCraftingList } from "./views/list";
import { renderModerate } from "./views/moderate";
import { renderProfession, renderProfessionList } from "./views/professions";
import { renderRecipe } from "./views/recipe";

const app = document.getElementById("app")!;

/** Tools the site had before it became a crafting companion (November 2026); see server/pages.ts. */
const RETIRED = new Set([
  "talents", "builds", "gear", "sets", "flights", "leveling", "legacy", "compare", "changes", "news", "races",
  "account", "admin", "login", "signup", "forgot-password", "reset-password", "verify-email", "unsubscribe",
]);

async function route() {
  const parts = location.pathname.split("/").filter(Boolean);
  const params = new URLSearchParams(location.search);
  document.querySelectorAll<HTMLAnchorElement>(".site-nav > a[data-link]").forEach((a) => {
    const section = a.getAttribute("href")!.split("/")[1];
    a.classList.toggle("active", section === (parts[0] ?? ""));
    if (a.classList.contains("active")) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  closeMenu();
  document.body.classList.toggle("is-home", !parts[0]);
  setTitle(""); // views set their own; this keeps a stale title from sticking on pages that don't
  try {
    switch (parts[0]) {
      case undefined:
        return await renderHome(app);
      case "professions":
        if (!parts[1]) return await renderProfessionList(app);
        if (/^\d+$/.test(parts[2] ?? "")) return await renderRecipe(app, parts[1], Number(parts[2]));
        return await renderProfession(app, parts[1], params);
      case "list":
        return await renderCraftingList(app, params);
      case "items":
        return /^\d+$/.test(parts[1] ?? "") ? await renderItem(app, Number(parts[1])) : await renderItemList(app, params);
      case "moderate":
        return renderModerate(app, params);
      case "privacy":
        return renderPrivacy(app);
      case "imprint":
        return renderImprint(app);
      default:
        if (RETIRED.has(parts[0])) {
          setTitle("This tool was retired");
          app.innerHTML = `<section class="page"><div class="empty"><h1>This tool was retired</h1>
            <p>Forever Forge is now a crafting companion: every recipe of every profession in WoW Forever.</p>
            <a class="btn primary" href="/" data-link>Browse professions</a></div></section>`;
          return;
        }
        setTitle("Page not found");
        app.innerHTML = `<section class="page"><div class="empty"><h1>Page not found</h1>
          <p>That page doesn't exist.</p><a class="btn" href="/" data-link>Go home</a></div></section>`;
    }
  } catch (err) {
    app.innerHTML = `<section class="page"><div class="empty"><h1>Something went wrong</h1><p>${esc(String(err))}</p></div></section>`;
    throw err;
  }
}

function closeMenu() {
  document.body.classList.remove("menu-open");
  document.getElementById("menu-toggle")?.setAttribute("aria-expanded", "false");
  document.querySelectorAll<HTMLDetailsElement>(".nav-menu").forEach((d) => d.removeAttribute("open"));
}

document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
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
/** How many crafts are on the crafting list, next to its menu entry. */
function showListCount() {
  const n = craftingList.count();
  const el = document.getElementById("list-count")!;
  el.hidden = !n;
  el.textContent = String(n);
}
showListCount();
window.addEventListener("ff:list", showListCount);
window.addEventListener("storage", showListCount);
loadAdScript();
showSupportLinks();
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
