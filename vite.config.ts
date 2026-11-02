import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";

/** Writes dist/ads.txt from VITE_ADSENSE_CLIENT so AdSense can verify the publisher. */
function adsTxt(client: string | undefined): Plugin {
  return {
    name: "ads-txt",
    apply: "build",
    writeBundle(options) {
      if (!client) return;
      const pub = client.replace(/^ca-/, "");
      writeFileSync(resolve(options.dir ?? "dist", "ads.txt"), `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`);
    },
  };
}

/** Puts the AdSense loader in <head> of the built page, so Google's crawler sees it in the raw HTML
 * (the site verification and review need that). src/ads.ts skips loading it again. */
function adsenseHead(client: string | undefined): Plugin {
  return {
    name: "adsense-head",
    apply: "build",
    transformIndexHtml() {
      if (!client) return [];
      return [
        {
          tag: "script",
          attrs: {
            async: true,
            src: `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`,
            crossorigin: "anonymous",
            "data-adsense": "",
          },
          injectTo: "head",
        },
      ];
    },
  };
}

/** Writes the static sitemaps from the generated game data: sitemap.xml (index), sitemap-pages.xml
 * and sitemap-items.xml. Community builds come from the database via /sitemap-builds.xml. */
function sitemaps(site: string | undefined): Plugin {
  return {
    name: "sitemaps",
    apply: "build",
    writeBundle(options) {
      if (!site) return;
      const dir = options.dir ?? "dist";
      const data = (p: string) => JSON.parse(readFileSync(resolve("public/data", p), "utf8"));
      const meta = data("meta.json") as { generated: string; classes: { slug: string }[] };
      const lastmod = meta.generated.slice(0, 10);
      const classes = meta.classes.map((c) => c.slug);
      const professions = (data("professions/index.json") as { slug: string }[]).map((p) => p.slug);
      const items = (data("items/db/index.json") as { rows: [number, string, number, number, number][] }).rows
        .filter((r) => r[4] <= 60) // items above the level cap can't be used in the game
        .map((r) => `/items/${r[0]}`);
      const pages = [
        "/", "/builds", "/items", "/changes", "/news", "/races", "/legacy", "/gear", "/compare", "/professions",
        "/flights/eastern-kingdoms", "/flights/kalimdor", "/sets",
        ...(data("sets.json") as { sets: { id: number }[] }).sets.map((s) => `/sets/${s.id}`),
        ...classes.flatMap((c) => [`/talents/${c}`, `/changes/classic/${c}`, `/leveling/${c}`, `/gear/${c}`]),
        ...professions.map((p) => `/professions/${p}`),
        "/privacy", "/imprint",
      ];
      const urlset = (paths: string[]) =>
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths
          .map((p) => `  <url><loc>${site}${p}</loc><lastmod>${lastmod}</lastmod></url>`)
          .join("\n")}\n</urlset>\n`;
      writeFileSync(resolve(dir, "sitemap-pages.xml"), urlset(pages));
      writeFileSync(resolve(dir, "sitemap-items.xml"), urlset(items));
      writeFileSync(
        resolve(dir, "sitemap.xml"),
        `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${["sitemap-pages.xml", "sitemap-items.xml", "sitemap-builds.xml"]
          .map((f) => `  <sitemap><loc>${site}/${f}</loc><lastmod>${lastmod}</lastmod></sitemap>`)
          .join("\n")}\n</sitemapindex>\n`,
      );
    },
  };
}

// In development the API runs in `wrangler pages dev` on :8788; Vite forwards /api to it.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [adsTxt(env.VITE_ADSENSE_CLIENT), adsenseHead(env.VITE_ADSENSE_CLIENT), sitemaps(env.VITE_SITE_URL)],
    server: {
      proxy: {
        "/api": { target: "http://localhost:8788", changeOrigin: false },
        "/og": { target: "http://localhost:8788", changeOrigin: false },
      },
    },
    test: {
      // The API tests boot a local workerd; give them time.
      testTimeout: 90_000,
      hookTimeout: 60_000,
    },
  };
});
