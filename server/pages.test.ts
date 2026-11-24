import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Env } from "./http";
import { pageHtml, resolvePage } from "./pages";

// Serves the real generated data, and index.html as the app shell, like the ASSETS binding does.
const env = {
  APP_URL: "https://wow-forever-forge.com",
  ASSETS: {
    fetch: async (url: string) => {
      const path = new URL(url).pathname;
      try {
        if (path === "/") return new Response(readFileSync(new URL("../index.html", import.meta.url)), { headers: { "Content-Type": "text/html" } });
        return new Response(readFileSync(new URL(`../public${path}`, import.meta.url)));
      } catch {
        return new Response("not found", { status: 404 });
      }
    },
  },
} as unknown as Env;

const get = (path: string, host = "wow-forever-forge.com") => new Request(`https://${host}${path}`);

describe("server-rendered pages", () => {
  it("lists every profession on the home page, with recipe counts", async () => {
    const page = await resolvePage(get("/"), env);
    expect(page).toMatchObject({ status: 200, canonical: "/" });
    expect(page.body).toContain('<a href="/professions/blacksmithing">Blacksmithing</a>');
    expect(page.description).toMatch(/^Every crafting recipe in World of Warcraft: Forever/);
  });

  it("gives profession pages their recipes as text, and 404s unknown professions", async () => {
    const page = await resolvePage(get("/professions/blacksmithing"), env);
    expect(page).toMatchObject({ status: 200, canonical: "/professions/blacksmithing", title: "Blacksmithing Recipes & Guide for WoW Forever · Forever Forge" });
    expect(page.body).toContain('href="/professions/blacksmithing/16994">Arcanite Reaper</a> (skill 300)');
    expect((await resolvePage(get("/professions/basket-weaving"), env)).status).toBe(404);
  });

  it("renders recipes with reagents, the made item and breadcrumbs, and 404s unknown ones", async () => {
    const page = await resolvePage(get("/professions/blacksmithing/16994"), env);
    expect(page).toMatchObject({ status: 200, canonical: "/professions/blacksmithing/16994" });
    expect(page.title).toBe("Arcanite Reaper (Blacksmithing recipe, WoW Forever) · Forever Forge");
    expect(page.description).toContain("learned at skill 300");
    expect(page.description).toContain("Arcanite Bar");
    expect(page.body).toContain('Creates <a href="/items/12784">Arcanite Reaper</a>');
    expect(JSON.stringify(page.jsonLd)).toContain("BreadcrumbList");
    expect((await resolvePage(get("/professions/blacksmithing/1"), env)).status).toBe(404);
    expect((await resolvePage(get("/professions/blacksmithing/16994/x"), env)).status).toBe(404);
  });

  it("renders items with their tooltip text and breadcrumbs, and 404s unknown ones", async () => {
    const page = await resolvePage(get("/items/19019"), env);
    expect(page.status).toBe(200);
    expect(page.title).toBe("Thunderfury, Blessed Blade of the Windseeker (WoW Forever item) · Forever Forge");
    expect(page.body).toContain("Chance on hit: Blasts your enemy with lightning");
    expect(JSON.stringify(page.jsonLd)).toContain("BreadcrumbList");
    expect((await resolvePage(get("/items/999999"), env)).status).toBe(404);
    expect((await resolvePage(get("/items/abc"), env)).status).toBe(404);
  });

  it("answers 410 Gone for the retired tools and 404 for unknown pages", async () => {
    expect((await resolvePage(get("/nope"), env)).status).toBe(404);
    for (const p of ["/talents/mage", "/builds", "/sets/321", "/flights/kalimdor", "/login", "/account"]) {
      expect(await resolvePage(get(p), env)).toMatchObject({ status: 410, noindex: true });
    }
  });

  it("builds the head tags, status and noindex rules for the served HTML", async () => {
    const item = pageHtml(await resolvePage(get("/items/19019"), env), get("/items/19019"), env);
    expect(item.status).toBe(200);
    expect(item.head).toContain('<link rel="canonical" href="https://wow-forever-forge.com/items/19019" />');
    expect(item.head).toContain('<script type="application/ld+json">');
    expect(item.head).not.toContain('name="robots"');
    expect(item.head).toContain('<meta property="og:image" content="https://wow-forever-forge.com/og-default.png" />');
    expect(item.ogUrl).toBe("https://wow-forever-forge.com/items/19019");

    const missing = pageHtml(await resolvePage(get("/does-not-exist"), env), get("/does-not-exist"), env);
    expect(missing.status).toBe(404);
    expect(missing.head).toContain('<meta name="robots" content="noindex" />');

    // Preview deployments are for testing only: noindex, no canonical.
    const previewReq = get("/professions/alchemy", "abc123.forever-forge.pages.dev");
    const preview = pageHtml(await resolvePage(previewReq, env), previewReq, env);
    expect(preview.noindex).toBe(true);
    expect(preview.head).not.toContain("canonical");
  });
});
