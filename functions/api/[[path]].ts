import { handle, type Env } from "../../server/api";

export const onRequest: PagesFunction<Env> = (ctx) => handle(ctx.request, ctx.env);
