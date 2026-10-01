// One public address: www and the old pages.dev production address redirect permanently to the
// canonical domain (APP_URL), so search engines and share links only ever see wow-forever-forge.com.
// Per-deployment preview URLs (<hash>.forever-forge.pages.dev) are left alone for testing.

import type { Env } from "../server/http";

const ALIASES = (canonical: string) => [`www.${canonical}`, "forever-forge.pages.dev"];

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const canonical = ctx.env.APP_URL ? new URL(ctx.env.APP_URL).hostname : "";
  if (canonical && ALIASES(canonical).includes(url.hostname)) {
    url.protocol = "https:";
    url.hostname = canonical;
    url.port = "";
    return Response.redirect(url.toString(), 301);
  }
  return ctx.next();
};
