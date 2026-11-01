import { initWasm, Resvg } from "@resvg/resvg-wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import type { Env } from "../../server/http";
import { handleOg } from "../../server/og-route";

let ready: Promise<void> | null = null;

export const onRequest: PagesFunction<Env> = async (ctx) => {
  // Free plan: no rendering (too much CPU), every card is the site-wide one.
  if (ctx.env.OG_IMAGES === "static") return Response.redirect(new URL("/og-default.png", ctx.request.url).toString(), 302);
  ready ??= initWasm(resvgWasm);
  await ready;
  return handleOg(ctx.request, ctx.env, { Resvg } as never);
};
