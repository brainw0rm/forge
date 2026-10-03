// Flight map and route planner: every learnable flight point and route in the client, per
// continent and faction, on a map drawn from the client's own data (no map artwork).

import { adSlot, fillAds } from "../ads";
import { buildLabel, getMeta, load } from "../data";
import { esc, setTitle } from "../ui";

type Faction = "alliance" | "horde";
type Point = [number, number];

export interface FlightNode {
  id: number;
  name: string;
  zone: string;
  continent: number;
  faction: Faction | "both";
  /** 0..1 across the continent map. */
  x: number;
  y: number;
  isNew: boolean;
}

export interface FlightPath {
  a: number;
  b: number;
  /** Price in copper and distance flown in yards, a → b and b → a. */
  costAB?: number;
  costBA?: number;
  distAB?: number;
  distBA?: number;
  isNew: boolean;
}

export interface FlightData {
  continents: { id: number; name: string; land: Point[][] }[];
  nodes: FlightNode[];
  paths: FlightPath[];
  zones: { name: string; continent: number; x: number; y: number; isNew: boolean; shape: Point[][] }[];
}

export const getFlights = () => load<FlightData>("flights.json");

export const CONTINENTS = [
  { id: 0, slug: "eastern-kingdoms", name: "Eastern Kingdoms" },
  { id: 1, slug: "kalimdor", name: "Kalimdor" },
];

const FACTION_LABEL = { alliance: "Alliance", horde: "Horde", both: "Both factions" };
// The continent maps are 3:2; positions are 0..1 on each axis.
const ASPECT = 2 / 3;
// The drawing is this many units wide, whatever the continent's size, so text and dots keep one size.
const VIEW_W = 800;
const PAD = 24;

export function money(copper: number) {
  const g = Math.floor(copper / 10000);
  const s = Math.floor((copper % 10000) / 100);
  const c = copper % 100;
  return [g && `${g}g`, s && `${s}s`, c && `${c}c`].filter(Boolean).join(" ") || "free";
}

export interface Leg {
  from: FlightNode;
  to: FlightNode;
  cost?: number;
  isNew: boolean;
}

/** Shortest trip by distance flown, over the given flight points (Dijkstra). Null if unreachable. */
export function planRoute(nodes: Map<number, FlightNode>, paths: FlightPath[], from: number, to: number): Leg[] | null {
  const edges = new Map<number, { to: number; dist: number; cost: number; isNew: boolean }[]>();
  const add = (a: number, b: number, dist: number | undefined, cost: number | undefined, isNew: boolean) => {
    if (cost === undefined) return; // no route in this direction
    const pa = nodes.get(a)!, pb = nodes.get(b)!;
    // Every route in the client has its path; the straight line is only a fallback.
    const d = dist ?? Math.hypot(pa.x - pb.x, (pa.y - pb.y) * ASPECT) * 35000;
    edges.set(a, [...(edges.get(a) ?? []), { to: b, dist: d, cost, isNew }]);
  };
  for (const p of paths) {
    if (!nodes.has(p.a) || !nodes.has(p.b)) continue;
    add(p.a, p.b, p.distAB, p.costAB, p.isNew);
    add(p.b, p.a, p.distBA, p.costBA, p.isNew);
  }
  const best = new Map<number, number>([[from, 0]]);
  const prev = new Map<number, { node: number; cost: number; isNew: boolean }>();
  const open = new Set([from]);
  while (open.size) {
    const cur = [...open].reduce((m, n) => (best.get(n)! < best.get(m)! ? n : m));
    open.delete(cur);
    if (cur === to) break;
    for (const e of edges.get(cur) ?? []) {
      const d = best.get(cur)! + e.dist;
      if (d < (best.get(e.to) ?? Infinity)) {
        best.set(e.to, d);
        prev.set(e.to, { node: cur, cost: e.cost, isNew: e.isNew });
        open.add(e.to);
      }
    }
  }
  if (from === to) return [];
  if (!prev.has(to)) return null;
  const legs: Leg[] = [];
  for (let at = to; at !== from; ) {
    const p = prev.get(at)!;
    legs.unshift({ from: nodes.get(p.node)!, to: nodes.get(at)!, cost: p.cost, isNew: p.isNew });
    at = p.node;
  }
  return legs;
}

function storedFaction(): Faction | null {
  try {
    const f = localStorage.getItem("ff:faction");
    return f === "alliance" || f === "horde" ? f : null;
  } catch {
    return null;
  }
}

export async function renderFlights(root: HTMLElement, slug: string, params: URLSearchParams) {
  const [meta, data] = await Promise.all([getMeta(), getFlights()]);
  const cont = CONTINENTS.find((c) => c.slug === slug) ?? CONTINENTS[0];
  setTitle(`${cont.name} Flight Paths in WoW Forever`, `Flight map and route planner for ${cont.name} in World of Warcraft: Forever, with the new flight points marked.`);

  const land = data.continents.find((c) => c.id === cont.id)?.land ?? [];
  const allNodes = data.nodes.filter((n) => n.continent === cont.id);
  const zones = data.zones.filter((z) => z.continent === cont.id);
  const freshZones = zones.filter((z) => z.isNew);

  const param = params.get("faction");
  let faction: Faction = param === "alliance" || param === "horde" ? param : (storedFaction() ?? "alliance");
  let from: number | null = Number(params.get("from")) || null;
  let to: number | null = Number(params.get("to")) || null;

  // Fit the land into the drawing, keeping the map's proportions.
  const pts = [...land.flat(), ...allNodes.map((n): Point => [n.x, n.y])];
  const minX = Math.min(...pts.map((p) => p[0])), maxX = Math.max(...pts.map((p) => p[0]));
  const minY = Math.min(...pts.map((p) => p[1] * ASPECT)), maxY = Math.max(...pts.map((p) => p[1] * ASPECT));
  const scale = (VIEW_W - PAD * 2) / (maxX - minX);
  const px = (x: number) => +((x - minX) * scale + PAD).toFixed(1);
  const py = (y: number) => +((y * ASPECT - minY) * scale + PAD).toFixed(1);
  const viewH = Math.ceil((maxY - minY) * scale + PAD * 2);
  const shape = (loops: Point[][]) => loops.map((l) => `M${l.map(([x, y]) => `${px(x)} ${py(y)}`).join("L")}Z`).join("");

  const mapBase = `
    <defs>
      <radialGradient id="fm-sea" cx="50%" cy="45%" r="75%"><stop offset="0" class="fm-sea-1"/><stop offset="1" class="fm-sea-2"/></radialGradient>
      <filter id="fm-glow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="7"/></filter>
    </defs>
    <rect width="${VIEW_W}" height="${viewH}" fill="url(#fm-sea)"/>
    <path class="fm-coast-glow" d="${shape(land)}" filter="url(#fm-glow)"/>
    <path class="fm-land" d="${shape(land)}" fill-rule="evenodd"/>
    <g class="fm-zone-shapes">${zones.map((z) => `<path d="${shape(z.shape)}" fill-rule="evenodd" class="${z.isNew ? "new" : ""}"/>`).join("")}</g>
    <path class="fm-coast" d="${shape(land)}" fill-rule="evenodd"/>
    <g class="fm-zones">${zones
      .map((z) => `<text x="${px(z.x)}" y="${py(z.y)}" class="${z.isNew ? "new" : ""}">${esc(z.name)}${z.isNew ? `<tspan x="${px(z.x)}" dy="11">new zone</tspan>` : ""}</text>`)
      .join("")}</g>`;

  root.innerHTML = `
    <section class="page flights">
      <header class="page-head">
        <div>
          <h1>Flight paths</h1>
          <p class="lede">Every flight point and route in the WoW Forever client, with a route planner.
            Flight points, routes and zones that Classic Era doesn't have are marked in gold.</p>
        </div>
      </header>
      <nav class="class-tabs fm-tabs" aria-label="Continent">
        ${CONTINENTS.map((c) => `<a href="/flights/${c.slug}" data-link class="${c.id === cont.id ? "active" : ""}" style="--c:var(--gold)">${esc(c.name)}</a>`).join("")}
      </nav>
      <div class="fm-bar">
        <p class="fm-stats" id="fm-stats"></p>
        <div class="lens-switch" role="group" aria-label="Faction">
          ${(["alliance", "horde"] as const).map((f) => `<button class="lens-btn" data-faction="${f}" aria-pressed="${faction === f}">${FACTION_LABEL[f]}</button>`).join("")}
        </div>
      </div>
      <div class="fm-layout">
        <div class="fm-map-wrap"><svg class="fm-map" id="fm-map" viewBox="0 0 ${VIEW_W} ${viewH}" role="img" aria-label="${esc(cont.name)} flight map">
          ${mapBase}<g id="fm-live"></g></svg></div>
        <aside class="fm-panel" id="fm-panel">
          <h2>Plan a flight</h2>
          <div class="fm-plan">
            <label><span>From</span><select id="fm-from"></select></label>
            <button type="button" class="icon-btn fm-swap" id="fm-swap" aria-label="Swap start and destination" title="Swap">⇅</button>
            <label><span>To</span><select id="fm-to"></select></label>
          </div>
          <div id="fm-result" aria-live="polite"></div>
        </aside>
      </div>
      <p class="data-note">Flight points, routes and prices come from the ${esc(buildLabel(meta, meta.build))} client and are compared with Classic Era ${esc(meta.classicBuild)}.
        The map is drawn from the outlines of the explorable areas on the client's zone maps, so coastlines are approximate. Lines show which points connect directly; the actual flight curves around.
        The planner picks the shortest trip by distance flown and adds up each leg's base price. You need to know every flight point along the way.
        <button type="button" class="link-btn" data-report-bug data-kind="data">Something look wrong?</button></p>
      ${adSlot("leaderboard")}
      <h2 class="section-title">All ${esc(cont.name)} flight points</h2>
      <div class="fm-list" id="fm-list"></div>
    </section>`;

  const page = root.querySelector<HTMLElement>(".flights")!;
  const svg = root.querySelector<SVGSVGElement>("#fm-map")!;
  const live = root.querySelector<SVGGElement>("#fm-live")!;
  const panel = root.querySelector<HTMLElement>("#fm-panel")!;
  const result = root.querySelector<HTMLElement>("#fm-result")!;
  const fromSel = root.querySelector<HTMLSelectElement>("#fm-from")!;
  const toSel = root.querySelector<HTMLSelectElement>("#fm-to")!;
  const stats = root.querySelector<HTMLElement>("#fm-stats")!;
  const list = root.querySelector<HTMLElement>("#fm-list")!;

  const usable = (n: FlightNode) => n.faction === faction || n.faction === "both";

  const draw = () => {
    const nodes = new Map(allNodes.filter(usable).map((n) => [n.id, n]));
    if (from && !nodes.has(from)) from = null;
    if (to && !nodes.has(to)) to = null;
    const paths = data.paths.filter((p) => nodes.has(p.a) && nodes.has(p.b));
    const direct = (id: number) =>
      paths
        .filter((p) => p.a === id || p.b === id)
        .map((p) => ({ node: nodes.get(p.a === id ? p.b : p.a)!, cost: p.a === id ? p.costAB : p.costBA, isNew: p.isNew }))
        .sort((r1, r2) => r1.node.name.localeCompare(r2.node.name));
    const legs = from && to ? planRoute(nodes, paths, from, to) : null;

    // What to highlight: the planned trip, or the direct flights from the start point.
    const lit = new Set<number>();
    const litEdges = new Set<string>();
    const edge = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
    if (legs) for (const l of legs) lit.add(l.from.id), lit.add(l.to.id), litEdges.add(edge(l.from.id, l.to.id));
    else if (from) for (const r of direct(from)) lit.add(r.node.id), litEdges.add(edge(from, r.node.id));
    if (from) lit.add(from);
    const focus = from !== null;

    const fresh = [...nodes.values()].filter((n) => n.isNew);
    stats.innerHTML = `<b>${nodes.size}</b> ${FACTION_LABEL[faction]} flight points · <b>${paths.length}</b> routes${
      fresh.length ? ` · <b class="fm-gold">${fresh.length}</b> new` : ""
    }${freshZones.length ? ` · new zone${freshZones.length > 1 ? "s" : ""}: <b class="fm-gold">${freshZones.map((z) => esc(z.name)).join(", ")}</b>` : ""}`;

    live.innerHTML = `
      <g class="fm-routes">${paths
        .map((p) => {
          const a = nodes.get(p.a)!, b = nodes.get(p.b)!;
          const on = litEdges.has(edge(p.a, p.b));
          return `<line x1="${px(a.x)}" y1="${py(a.y)}" x2="${px(b.x)}" y2="${py(b.y)}" class="${p.isNew ? "new" : ""} ${on ? "on" : focus ? "dim" : ""}"/>`;
        })
        .join("")}</g>
      <g class="fm-nodes">${[...nodes.values()]
        .map((n) => {
          const role = n.id === from ? "start" : n.id === to ? "end" : "";
          const cls = [n.faction, n.isNew ? "new" : "", role, lit.has(n.id) ? "on" : focus ? "dim" : ""].join(" ");
          return `<g class="fm-node ${cls}" transform="translate(${px(n.x)} ${py(n.y)})" data-id="${n.id}" tabindex="0" role="button" aria-label="${esc(n.name)}, ${esc(n.zone)}">
            ${n.isNew ? `<circle r="9" class="halo"/>` : ""}
            <circle r="5"/>
            <text y="-10">${esc(n.name)}</text>
          </g>`;
        })
        .join("")}</g>`;

    // Planner fields: flight points grouped by zone.
    const options = (sel: number | null, placeholder: string) => {
      const byZone = new Map<string, FlightNode[]>();
      for (const n of nodes.values()) byZone.set(n.zone, [...(byZone.get(n.zone) ?? []), n]);
      return `<option value="">${placeholder}</option>${[...byZone.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([zone, ns]) => `<optgroup label="${esc(zone)}">${ns
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((n) => `<option value="${n.id}" ${n.id === sel ? "selected" : ""}>${esc(n.name)}${n.isNew ? " (new)" : ""}</option>`)
          .join("")}</optgroup>`)
        .join("")}`;
    };
    fromSel.innerHTML = options(from, "Where are you?");
    toSel.innerHTML = options(to, "Where to?");

    const stop = (n: FlightNode) => `<b>${esc(n.name)}</b><small>${esc(n.zone)}</small>${n.isNew ? `<span class="fm-tag">new</span>` : ""}`;
    if (from && to && legs === null) {
      result.innerHTML = `<p class="fm-none">No ${FACTION_LABEL[faction]} connection from ${esc(nodes.get(from)!.name)} to ${esc(nodes.get(to)!.name)} in this build.</p>
        <button type="button" class="btn small ghost" id="fm-clear">Clear</button>`;
    } else if (legs && legs.length) {
      const total = legs.reduce((s, l) => s + (l.cost ?? 0), 0);
      result.innerHTML = `
        <p class="fm-total"><b>${money(total)}</b><span>${legs.length === 1 ? "direct flight" : `${legs.length} legs, ${legs.length - 1} stop${legs.length > 2 ? "s" : ""} on the way`}</span></p>
        <ol class="fm-legs">
          <li class="fm-stop">${stop(legs[0].from)}</li>
          ${legs.map((l) => `<li class="fm-leg">${money(l.cost ?? 0)}${l.isNew ? ` <span class="fm-tag">new route</span>` : ""}</li><li class="fm-stop">${stop(l.to)}</li>`).join("")}
        </ol>
        <button type="button" class="btn small ghost" id="fm-clear">Clear</button>`;
    } else if (from) {
      const routes = direct(from);
      result.innerHTML = routes.length
        ? `<h3>Direct flights from ${esc(nodes.get(from)!.name)}</h3><ul class="fm-direct">${routes
            .map((r) => `<li><button type="button" data-to="${r.node.id}"><span>${esc(r.node.name)}${r.isNew ? ` <span class="fm-tag">new</span>` : ""}</span><small>${esc(r.node.zone)}</small></button>
              <span class="fm-cost">${r.cost !== undefined ? money(r.cost) : "–"}</span></li>`)
            .join("")}</ul>
          <button type="button" class="btn small ghost" id="fm-clear">Clear</button>`
        : `<p class="muted">No routes to or from ${esc(nodes.get(from)!.name)} in this build yet.</p>
          <button type="button" class="btn small ghost" id="fm-clear">Clear</button>`;
    } else {
      result.innerHTML = `
        <p class="muted">Pick both ends here, or click two flight points on the map.</p>
        ${
          fresh.length
            ? `<h3>New in Forever</h3><ul class="fm-direct">${fresh
                .map((f) => `<li><button type="button" data-from="${f.id}"><span>${esc(f.name)}</span><small>${esc(f.zone)}</small></button></li>`)
                .join("")}</ul>`
            : ""
        }
        <ul class="fm-legend">
          <li><span class="fm-dot ${faction}"></span>${FACTION_LABEL[faction]}</li>
          <li><span class="fm-dot both"></span>Both factions</li>
          <li><span class="fm-dot new"></span>New flight point</li>
          <li><span class="fm-line"></span>New route</li>
        </ul>`;
    }

    const byZone = new Map<string, FlightNode[]>();
    for (const x of nodes.values()) byZone.set(x.zone, [...(byZone.get(x.zone) ?? []), x]);
    list.innerHTML = [...byZone.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([zone, ns]) => `<div class="fm-zone"><h3>${esc(zone)}${zones.some((z) => z.name === zone && z.isNew) ? ` <span class="fm-tag">new zone</span>` : ""}</h3>
          <ul>${ns
            .map(
              (x) => `<li><button type="button" data-from="${x.id}" class="${x.id === from ? "sel" : ""}"><span class="fm-dot ${x.faction}"></span>${esc(x.name)}
                ${x.isNew ? `<span class="fm-tag">new</span>` : ""}<small>${direct(x.id).length} routes</small></button></li>`,
            )
            .join("")}</ul></div>`,
      )
      .join("");
  };

  const syncUrl = () => {
    const q = new URLSearchParams({ faction });
    if (from) q.set("from", String(from));
    if (to) q.set("to", String(to));
    history.replaceState(null, "", `/flights/${cont.slug}?${q}`);
  };
  const update = (scrollTo?: Element) => {
    syncUrl();
    draw();
    scrollTo?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  // Phones: the planner sits under the map, so bring it into view once a trip is picked.
  const stacked = () => matchMedia("(max-width: 960px)").matches;

  /** Map clicks fill the planner: first the start, then the destination, then start over. */
  const pick = (id: number) => {
    if (!from || to) (from = id), (to = null);
    else if (id !== from) to = id;
    update(to && stacked() ? panel : undefined);
  };

  root.querySelectorAll<HTMLButtonElement>("[data-faction]").forEach((btn) =>
    btn.addEventListener("click", () => {
      faction = btn.dataset.faction as Faction;
      try {
        localStorage.setItem("ff:faction", faction);
      } catch {
        /* private mode */
      }
      root.querySelectorAll("[data-faction]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      update();
    }),
  );
  svg.addEventListener("click", (e) => {
    const g = (e.target as Element).closest<SVGGElement>(".fm-node");
    if (g) pick(Number(g.dataset.id));
  });
  svg.addEventListener("keydown", (e) => {
    const g = (e.target as Element).closest<SVGGElement>(".fm-node");
    if (g && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      pick(Number(g.dataset.id));
    }
  });
  fromSel.addEventListener("change", () => {
    from = Number(fromSel.value) || null;
    if (from === to) to = null;
    update();
  });
  toSel.addEventListener("change", () => {
    to = Number(toSel.value) || null;
    update(to && stacked() ? panel : undefined);
  });
  page.addEventListener("click", (e) => {
    const t = e.target as Element;
    if (t.closest("#fm-swap")) {
      [from, to] = [to, from];
      return update();
    }
    if (t.closest("#fm-clear")) {
      from = to = null;
      return update();
    }
    const dest = t.closest<HTMLElement>("[data-to]");
    if (dest) {
      to = Number(dest.dataset.to);
      return update();
    }
    const start = t.closest<HTMLElement>("[data-from]");
    if (start) {
      from = Number(start.dataset.from);
      to = null;
      update(start.closest("#fm-list") ? svg.parentElement! : undefined);
    }
  });

  syncUrl();
  draw();
  fillAds(root);
}
