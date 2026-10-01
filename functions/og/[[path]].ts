import { initWasm, Resvg } from "@resvg/resvg-wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import type { Env } from "../../server/http";
import { handleOg } from "../../server/og-route";

let ready: Promise<void> | null = null;

export const onRequest: PagesFunction<Env> = async (ctx) => {
  ready ??= initWasm(resvgWasm);
  await ready;
  return handleOg(ctx.request, ctx.env, { Resvg } as never);
};
