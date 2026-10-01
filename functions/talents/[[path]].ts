import type { Env } from "../../server/http";
import { talentsPageMeta, withMeta } from "../../server/meta";

export const onRequest: PagesFunction<Env> = (ctx) =>
  withMeta(ctx.request, ctx.env, talentsPageMeta(new URL(ctx.request.url)));
