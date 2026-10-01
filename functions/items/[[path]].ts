import type { Env } from "../../server/http";
import { itemPageMeta, withMeta } from "../../server/meta";

export const onRequest: PagesFunction<Env> = async (ctx) =>
  withMeta(ctx.request, ctx.env, await itemPageMeta(ctx.request, ctx.env));
