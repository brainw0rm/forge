// Runs in front of everything:
//   1. One public address: www and the old pages.dev production address redirect permanently to the
//      canonical domain (APP_URL). Per-deployment preview URLs stay reachable for testing.
//   2. Every page address (no file extension, not /api or /og) is rendered by server/pages.ts:
//      status code, head tags, structured data and pre-rendered content for search engines.
//   3. /sitemap-builds.xml lists the public community builds from the database.
// Static files (scripts, data, images, the other sitemaps) pass straight through.

import type { Env } from "../server/http";
import { buildsSitemap, renderPage } from "../server/pages";

const ALIASES = (canonical: string) => [`www.${canonical}`, "forever-forge.pages.dev"];
const isPage = (path: string) => !/\.[a-z0-9]+$/i.test(path) && !/^\/(api|og)(\/|$)/.test(path);

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const canonical = ctx.env.APP_URL ? new URL(ctx.env.APP_URL).hostname : "";
  if (canonical && ALIASES(canonical).includes(url.hostname)) {
    url.protocol = "https:";
    url.hostname = canonical;
    url.port = "";
    return Response.redirect(url.toString(), 301);
  }
  if (ctx.request.method === "GET" || ctx.request.method === "HEAD") {
    if (url.pathname === "/sitemap-builds.xml") return buildsSitemap(ctx.env, ctx.request);
    if (isPage(url.pathname)) return renderPage(ctx.request, ctx.env);
  }
  return ctx.next();
};
