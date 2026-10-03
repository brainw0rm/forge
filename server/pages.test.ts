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
  it("gives class pages a search-friendly title, canonical address and their talents as text", async () => {
    const page = await resolvePage(get("/talents/mage"), env);
    expect(page).toMatchObject({ status: 200, canonical: "/talents/mage", title: "Mage Talent Calculator for WoW Forever · Forever Forge" });
    expect(page.body).toContain("<h2>Frost</h2>");
    expect(page.body).toContain("Improved Frostbolt");
    // Shared build links point search engines at the class page.
    expect((await resolvePage(get("/talents/mage/Z00Z00"), env)).canonical).toBe("/talents/mage");
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

  it("returns real status codes: 404 for unknown pages, 301 to the canonical page", async () => {
    expect((await resolvePage(get("/nope"), env)).status).toBe(404);
    expect((await resolvePage(get("/talents/paladin/x/y/z"), env)).canonical).toBe("/talents/paladin");
    expect(await resolvePage(get("/talents"), env)).toMatchObject({ status: 301, redirect: "/talents/warrior" });
    expect(await resolvePage(get("/talents/notaclass"), env)).toMatchObject({ status: 301, redirect: "/talents/warrior" });
    expect((await resolvePage(get("/professions/alchemy"), env)).status).toBe(200);
    expect((await resolvePage(get("/professions/basket-weaving"), env)).status).toBe(404);
    expect(await resolvePage(get("/flights"), env)).toMatchObject({ status: 301, redirect: "/flights/eastern-kingdoms" });
    expect((await resolvePage(get("/flights/northrend"), env)).status).toBe(301);
  });

  it("lists every flight point of a continent, with the new ones called out", async () => {
    const page = await resolvePage(get("/flights/kalimdor"), env);
    expect(page).toMatchObject({ status: 200, canonical: "/flights/kalimdor", title: "Kalimdor Flight Paths in WoW Forever · Forever Forge" });
    expect(page.body).toContain("<h2>Mount Hyjal</h2>");
    expect(page.body).toContain("Summit of Eternity (both factions, new in Forever)");
    expect(page.description).toMatch(/^Flight map and route planner for Kalimdor/);
  });

  it("keeps private pages out of search results", async () => {
    for (const p of ["/account", "/login", "/admin", "/reset-password"]) expect((await resolvePage(get(p), env)).noindex).toBe(true);
  });

  it("builds the head tags, status and noindex rules for the served HTML", async () => {
    const item = pageHtml(await resolvePage(get("/items/19019"), env), get("/items/19019"), env);
    expect(item.status).toBe(200);
    expect(item.head).toContain('<link rel="canonical" href="https://wow-forever-forge.com/items/19019" />');
    expect(item.head).toContain('<script type="application/ld+json">');
    expect(item.head).not.toContain('name="robots"');
    expect(item.ogUrl).toBe("https://wow-forever-forge.com/items/19019");

    const missing = pageHtml(await resolvePage(get("/does-not-exist"), env), get("/does-not-exist"), env);
    expect(missing.status).toBe(404);
    expect(missing.head).toContain('<meta name="robots" content="noindex" />');

    // Preview deployments are for testing only: noindex, no canonical.
    const previewReq = get("/talents/mage", "abc123.forever-forge.pages.dev");
    const preview = pageHtml(await resolvePage(previewReq, env), previewReq, env);
    expect(preview.noindex).toBe(true);
    expect(preview.head).not.toContain("canonical");
  });
});
