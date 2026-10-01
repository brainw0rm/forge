// /og/build/<id>.png and /og/talents/<class>/<code>.png: social preview images.
// Needs the ASSETS binding (class data, fonts) and an initialized resvg module.

import { decode } from "../shared/code";
import { isClassSlug } from "../shared/validate";
import { HttpError, type Env } from "./http";
import { cardSvg, featuredTalents, renderPng, type CardTalent, type ResvgModule } from "./og";
import { findBuild } from "./routes/builds";

interface ClassJson {
  name: string;
  trees: { name: string; talents: { id: number; name: string; tier: number; ranks: string[]; icon: string }[] }[];
}
interface ChangelogJson {
  build: string;
  changes: { class: string; talent: number }[];
}

/** The game's class colors, kept in sync with src/data.ts. */
const CLASS_COLOR: Record<string, string> = {
  warrior: "#c69b6d", paladin: "#f48cba", hunter: "#aad372", rogue: "#fff468", priest: "#ffffff",
  shaman: "#0070dd", mage: "#3fc7eb", warlock: "#8788ee", druid: "#ff7c0a",
};
const FONTS = ["Inter_400Regular", "Inter_600SemiBold", "Inter_700Bold"];

let fontCache: Uint8Array[] | null = null;

async function asset<T>(env: Env, req: Request, path: string, kind: "json" | "bytes"): Promise<T> {
  if (!env.ASSETS) throw new Error("ASSETS binding missing");
  const res = await env.ASSETS.fetch(new URL(path, req.url).toString());
  if (!res.ok) throw new HttpError(404, `Missing asset ${path}`);
  return (kind === "json" ? await res.json() : new Uint8Array(await res.arrayBuffer())) as T;
}

async function iconData(name: string): Promise<string | null> {
  try {
    const res = await fetch(`https://render.worldofwarcraft.com/us/icons/56/${encodeURIComponent(name)}.jpg`, {
      cf: { cacheTtl: 86400 * 7, cacheEverything: true },
    } as RequestInit);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return `data:image/jpeg;base64,${btoa(bin)}`;
  } catch {
    return null;
  }
}

export async function handleOg(req: Request, env: Env, resvg: ResvgModule): Promise<Response> {
  const cache = typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined;
  const hit = await cache?.match(req).catch(() => undefined);
  if (hit) return hit;

  const path = new URL(req.url).pathname;
  let slug: string;
  let code: string;
  let title: string;
  let author: string | undefined;
  let rating: { avg: number; count: number } | undefined;
  let gameBuild: number | undefined;
  const saved = /^\/og\/build\/([A-Za-z0-9]{6,16})\.png$/.exec(path);
  const link = /^\/og\/talents\/([a-z]+)\/([A-Za-z0-9_-]{0,160})\.png$/.exec(path);
  try {
    if (saved) {
      const row = await findBuild(env, saved[1], null);
      slug = row.class;
      code = row.code;
      title = row.title;
      author = row.username;
      rating = row.rating_count ? { avg: row.rating_avg ?? 0, count: row.rating_count } : undefined;
      gameBuild = row.game_build;
    } else if (link && isClassSlug(link[1])) {
      slug = link[1];
      code = link[2];
      title = "";
      // Share links carry the game build they were made on as ?b=<build>.
      gameBuild = Number(new URL(req.url).searchParams.get("b")) || undefined;
    } else {
      return new Response("Not found", { status: 404 });
    }
  } catch (err) {
    if (err instanceof HttpError) return new Response("Not found", { status: 404 });
    throw err;
  }

  const [cls, meta, log] = await Promise.all([
    asset<ClassJson>(env, req, `/data/classes/${slug}.json`, "json"),
    asset<{ build: string }>(env, req, "/data/meta.json", "json"),
    asset<ChangelogJson[]>(env, req, "/data/changelog.json", "json"),
  ]);
  fontCache ??= await Promise.all(FONTS.map((f) => asset<Uint8Array>(env, req, `/og/${f}.ttf`, "bytes")));

  const order = decode(code);
  const ranks = new Map<number, number>();
  for (const id of order) ranks.set(id, (ranks.get(id) ?? 0) + 1);
  const treePoints = cls.trees.map((t) => t.talents.reduce((n, x) => n + (ranks.get(x.id) ?? 0), 0));
  const all = cls.trees.flatMap((t) => t.talents.map((x) => ({ ...x, rank: ranks.get(x.id) ?? 0, max: x.ranks.length })));
  const featured = featuredTalents(all, 8);
  const talents: CardTalent[] = await Promise.all(
    featured.map(async (t) => ({ name: t.name, rank: t.rank, max: t.max, icon: await iconData(t.icon) })),
  );
  const current = Number(meta.build.split(".").pop());
  const changedSince = gameBuild
    ? log
        .filter((e) => Number(e.build.split(".").pop()) > gameBuild!)
        .flatMap((e) => e.changes)
        .filter((c) => c.class === slug && ranks.has(c.talent)).length
    : 0;
  const main = treePoints.indexOf(Math.max(...treePoints));

  const svg = cardSvg({
    className: cls.name,
    classColor: CLASS_COLOR[slug] ?? "#f5e5cf",
    // Share links have no title; name them after the tree with the most points.
    title: title || (order.length ? `${cls.trees[main].name} ${cls.name}` : `${cls.name} talents`),
    split: treePoints.join("/"),
    points: order.length,
    author,
    rating,
    gameBuild: String(gameBuild ?? current),
    talents,
    changedSince,
  });
  const png = renderPng(resvg, svg, fontCache);
  const res = new Response(png, {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
  });
  await cache?.put(req, res.clone()).catch(() => undefined);
  return res;
}
