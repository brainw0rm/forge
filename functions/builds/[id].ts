import type { Env } from "../../server/http";
import { buildPageMeta, withMeta } from "../../server/meta";

export const onRequest: PagesFunction<Env> = async (ctx) =>
  withMeta(ctx.request, ctx.env, await buildPageMeta(ctx.env, String(ctx.params.id)));
