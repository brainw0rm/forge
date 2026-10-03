// Flight map: every learnable flight point and route in the client, per continent, with the ones
// Classic Era doesn't have marked. Drawn from the client's own coordinates; no map artwork.

import { adSlot, fillAds } from "../ads";
import { buildLabel, getMeta, load } from "../data";
import { esc, setTitle } from "../ui";

type Faction = "alliance" | "horde" | "both";

export interface FlightNode {
  id: number;
  name: string;
  zone: string;
  continent: number;
  faction: Faction;
  /** 0..1 across the continent map. */
  x: number;
  y: number;
  isNew: boolean;
}

export interface FlightPath {
  a: number;
  b: number;
  /** Copper, a → b and b → a. */
  costAB?: number;
  costBA?: number;
  isNew: boolean;
  line: [number, number][];
}

export interface FlightData {
  continents: { id: number; name: string }[];
  nodes: FlightNode[];
  paths: FlightPath[];
  zones: { name: string; continent: number; x: number; y: number; isNew: boolean }[];
}

export const getFlights = () => load<FlightData>("flights.json");

export const CONTINENTS = [
  { id: 0, slug: "eastern-kingdoms", name: "Eastern Kingdoms" },
  { id: 1, slug: "kalimdor", name: "Kalimdor" },
];

const FACTION_LABEL: Record<Faction, string> = { alliance: "Alliance", horde: "Horde", both: "Both factions" };
// The continent maps are 3:2; positions are 0..1 on each axis.
const ASPECT = 2 / 3;
// The drawing is this many units wide, whatever the continent's size, so text and dots keep one size.
const VIEW_W = 800;
const PAD_X = 64; // zone names are centered on their zone and stick out sideways
const PAD_Y = 30;

export function money(copper: number) {
  const g = Math.floor(copper / 10000);
  const s = Math.floor((copper % 10000) / 100);
  const c = copper % 100;
  return [g && `${g}g`, s && `${s}s`, c && `${c}c`].filter(Boolean).join(" ") || "free";
}

export async function renderFlights(root: HTMLElement, slug: string, params: URLSearchParams) {
  const [meta, data] = await Promise.all([getMeta(), getFlights()]);
  const cont = CONTINENTS.find((c) => c.slug === slug) ?? CONTINENTS[0];
  setTitle(`${cont.name} Flight Paths in WoW Forever`, `Every flight point and route in ${cont.name} in World of Warcraft: Forever, with the new ones marked.`);

  const nodes = data.nodes.filter((n) => n.continent === cont.id);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const paths = data.paths.filter((p) => byId.has(p.a) && byId.has(p.b));
  const zones = data.zones.filter((z) => z.continent === cont.id);
  const fresh = nodes.filter((n) => n.isNew);
  const freshZones = zones.filter((z) => z.isNew);

  let faction = (["alliance", "horde"] as const).find((f) => f === params.get("faction")) ?? "all";
  let selected: number | null = Number(params.get("at")) || null;
  if (selected && !byId.has(selected)) selected = null;

  // Crop to what's drawn, keeping the map's proportions.
  const xs = [...nodes.map((n) => n.x), ...zones.map((z) => z.x)];
  const ys = [...nodes.map((n) => n.y * ASPECT), ...zones.map((z) => z.y * ASPECT)];
  const scale = (VIEW_W - PAD_X * 2) / (Math.max(...xs) - Math.min(...xs));
  const px = (x: number) => +((x - Math.min(...xs)) * scale + PAD_X).toFixed(1);
  const py = (y: number) => +((y * ASPECT - Math.min(...ys)) * scale + PAD_Y).toFixed(1);
  const viewH = Math.ceil((Math.max(...ys) - Math.min(...ys)) * scale + PAD_Y * 2);

  const routesOf = (id: number) =>
    paths
      .filter((p) => p.a === id || p.b === id)
      .map((p) => {
        const to = byId.get(p.a === id ? p.b : p.a)!;
        return { to, there: p.a === id ? p.costAB : p.costBA, back: p.a === id ? p.costBA : p.costAB, isNew: p.isNew };
      })
      .sort((r1, r2) => r1.to.name.localeCompare(r2.to.name));
  const visible = (n: FlightNode) => faction === "all" || n.faction === faction || n.faction === "both";
  // Alliance and Horde flight masters in the same town: label the town once.
  const twin = (n: FlightNode, shown: FlightNode[]) =>
    shown.some((o) => o.id < n.id && o.name === n.name && Math.hypot(px(o.x) - px(n.x), py(o.y) - py(n.y)) < 40);

  root.innerHTML = `
    <section class="page flights">
      <header class="page-head">
        <div>
          <h1>Flight paths</h1>
          <p class="lede">Every flight point and route in the WoW Forever client, drawn from the game's own coordinates.
            Anything Classic Era doesn't have is marked in gold.</p>
        </div>
      </header>
      <nav class="class-tabs fm-tabs" aria-label="Continent">
        ${CONTINENTS.map((c) => `<a href="/flights/${c.slug}" data-link class="${c.id === cont.id ? "active" : ""}" style="--c:var(--gold)">${esc(c.name)}</a>`).join("")}
      </nav>
      <div class="fm-bar">
        <p class="fm-stats"><b>${nodes.length}</b> flight points · <b>${paths.length}</b> routes${
          fresh.length ? ` · <b class="fm-gold">${fresh.length}</b> new flight point${fresh.length > 1 ? "s" : ""}` : ""
        }${freshZones.length ? ` · new zone${freshZones.length > 1 ? "s" : ""}: <b class="fm-gold">${freshZones.map((z) => esc(z.name)).join(", ")}</b>` : ""}</p>
        <div class="lens-switch" role="group" aria-label="Faction">
          ${(["all", "alliance", "horde"] as const)
            .map((f) => `<button class="lens-btn" data-faction="${f}" aria-pressed="${faction === f}">${f === "all" ? "All" : FACTION_LABEL[f]}</button>`)
            .join("")}
        </div>
      </div>
      <div class="fm-layout">
        <div class="fm-map-wrap"><svg class="fm-map" id="fm-map" viewBox="0 0 ${VIEW_W} ${viewH}" role="img" aria-label="${esc(cont.name)} flight map"></svg></div>
        <aside class="fm-panel" id="fm-panel" aria-live="polite"></aside>
      </div>
      <p class="data-note">Positions, routes and prices come from the ${esc(buildLabel(meta, meta.build))} client and are compared with Classic Era ${esc(meta.classicBuild)}.
        Prices are the base cost the client lists for each direction.
        <button type="button" class="link-btn" data-report-bug data-kind="data">Something look wrong?</button></p>
      ${adSlot("leaderboard")}
      <h2 class="section-title">All ${esc(cont.name)} flight points</h2>
      <div class="fm-list" id="fm-list"></div>
    </section>`;

  const page = root.querySelector<HTMLElement>(".flights")!;
  const svg = root.querySelector<SVGSVGElement>("#fm-map")!;
  const panel = root.querySelector<HTMLElement>("#fm-panel")!;
  const list = root.querySelector<HTMLElement>("#fm-list")!;

  const syncUrl = () => {
    const q = new URLSearchParams();
    if (faction !== "all") q.set("faction", faction);
    if (selected) q.set("at", String(selected));
    history.replaceState(null, "", `/flights/${cont.slug}${q.size ? `?${q}` : ""}`);
  };

  const draw = () => {
    const linked = new Set(selected ? routesOf(selected).map((r) => r.to.id) : []);
    const shown = paths.filter((p) => visible(byId.get(p.a)!) && visible(byId.get(p.b)!));
    svg.innerHTML = `
      <g class="fm-zones">${zones
        .map((z) => `<text x="${px(z.x)}" y="${py(z.y)}" class="${z.isNew ? "new" : ""}">${esc(z.name)}${z.isNew ? `<tspan x="${px(z.x)}" dy="12">new zone</tspan>` : ""}</text>`)
        .join("")}</g>
      <g class="fm-routes">${shown
        .map((p) => {
          const on = selected !== null && (p.a === selected || p.b === selected);
          const pts = p.line.map(([x, y]) => `${px(x)},${py(y)}`).join(" ");
          return `<polyline points="${pts}" class="${p.isNew ? "new" : ""} ${on ? "on" : ""} ${selected !== null && !on ? "dim" : ""}"/>`;
        })
        .join("")}</g>
      <g class="fm-nodes">${nodes
        .filter(visible)
        .map((n, _, shownNodes) => {
          const cls = [n.faction, n.isNew ? "new" : "", n.id === selected ? "sel" : "", selected && n.id !== selected && !linked.has(n.id) ? "dim" : ""].join(" ");
          return `<g class="fm-node ${cls}" transform="translate(${px(n.x)} ${py(n.y)})" data-id="${n.id}" tabindex="0" role="button" aria-label="${esc(n.name)}, ${esc(n.zone)}">
            ${n.isNew ? `<circle r="10" class="halo"/>` : ""}
            <circle r="5.5"/>
            ${twin(n, shownNodes) ? "" : `<text y="-11">${esc(n.name)}</text>`}
          </g>`;
        })
        .join("")}</g>`;

    const n = selected ? byId.get(selected)! : null;
    panel.innerHTML = n
      ? `<div class="fm-head">
          <span class="fm-dot ${n.faction}"></span>
          <div><h2>${esc(n.name)}</h2><p class="muted">${esc(n.zone)} · ${FACTION_LABEL[n.faction]}</p></div>
          <button type="button" class="icon-btn" id="fm-close" aria-label="Close">✕</button>
        </div>
        ${n.isNew ? `<p class="fm-new">New in Forever</p>` : ""}
        ${(() => {
          const routes = routesOf(n.id);
          if (!routes.length) return `<p class="muted">No routes to or from here in this build yet.</p>`;
          return `<h3>${routes.length} direct route${routes.length > 1 ? "s" : ""}</h3>
            <ul class="fm-routes-list">${routes
              .map(
                (r) => `<li><button type="button" data-go="${r.to.id}"><span>${esc(r.to.name)}${r.isNew ? ` <span class="fm-tag">new</span>` : ""}</span>
                  <small>${esc(r.to.zone)}</small></button>
                  <span class="fm-cost">${r.there !== undefined ? money(r.there) : "–"}${r.back !== undefined && r.back !== r.there ? `<small>back ${money(r.back)}</small>` : ""}</span></li>`,
              )
              .join("")}</ul>`;
        })()}`
      : `<h2>Pick a flight point</h2>
        <p class="muted">Click a point on the map to see where you can fly from there and what it costs.</p>
        ${
          fresh.length
            ? `<h3>New in Forever</h3><ul class="fm-routes-list">${fresh
                .map((f) => `<li><button type="button" data-go="${f.id}"><span>${esc(f.name)}</span><small>${esc(f.zone)} · ${FACTION_LABEL[f.faction]}</small></button></li>`)
                .join("")}</ul>`
            : ""
        }
        <ul class="fm-legend">
          <li><span class="fm-dot alliance"></span>Alliance</li>
          <li><span class="fm-dot horde"></span>Horde</li>
          <li><span class="fm-dot both"></span>Both factions</li>
          <li><span class="fm-dot new"></span>New in Forever</li>
        </ul>`;

    const byZone = new Map<string, FlightNode[]>();
    for (const x of nodes.filter(visible)) byZone.set(x.zone, [...(byZone.get(x.zone) ?? []), x]);
    list.innerHTML = [...byZone.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([zone, ns]) => `<div class="fm-zone"><h3>${esc(zone)}${zones.some((z) => z.name === zone && z.isNew) ? ` <span class="fm-tag">new zone</span>` : ""}</h3>
          <ul>${ns
            .map(
              (x) => `<li><button type="button" data-go="${x.id}" class="${x.id === selected ? "sel" : ""}"><span class="fm-dot ${x.faction}"></span>${esc(x.name)}
                ${x.isNew ? `<span class="fm-tag">new</span>` : ""}<small>${routesOf(x.id).length} routes</small></button></li>`,
            )
            .join("")}</ul></div>`,
      )
      .join("");
  };

  const select = (id: number | null, scrollTo?: Element) => {
    selected = id;
    syncUrl();
    draw();
    scrollTo?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  // Phones: the panel sits under the map, so bring it into view after a tap.
  const stacked = () => matchMedia("(max-width: 960px)").matches;

  root.querySelectorAll<HTMLButtonElement>("[data-faction]").forEach((btn) =>
    btn.addEventListener("click", () => {
      faction = btn.dataset.faction as typeof faction;
      root.querySelectorAll("[data-faction]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      if (selected && !visible(byId.get(selected)!)) selected = null;
      syncUrl();
      draw();
    }),
  );
  svg.addEventListener("click", (e) => {
    const g = (e.target as Element).closest<SVGGElement>(".fm-node");
    select(g ? Number(g.dataset.id) : null, g && stacked() ? panel : undefined);
  });
  svg.addEventListener("keydown", (e) => {
    const g = (e.target as Element).closest<SVGGElement>(".fm-node");
    if (g && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      select(Number(g.dataset.id));
    }
  });
  page.addEventListener("click", (e) => {
    const t = e.target as Element;
    if (t.closest("#fm-close")) return select(null);
    const go = t.closest<HTMLElement>("[data-go]");
    if (go) select(Number(go.dataset.go), go.closest("#fm-list") ? svg : undefined);
  });

  draw();
  fillAds(root);
}
