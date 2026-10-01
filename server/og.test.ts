import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { cardSvg, featuredTalents, renderPng, wrap, CARD_W, CARD_H, type ResvgModule } from "./og";

let resvg: ResvgModule;
const fonts = ["400Regular", "600SemiBold", "700Bold"].map(
  (w) => new Uint8Array(readFileSync(new URL(`../public/og/Inter_${w}.ttf`, import.meta.url))),
);

beforeAll(async () => {
  const mod = await import("@resvg/resvg-wasm");
  await mod.initWasm(readFileSync(new URL("../node_modules/@resvg/resvg-wasm/index_bg.wasm", import.meta.url)));
  resvg = mod as unknown as ResvgModule;
});

describe("social cards", () => {
  it("wraps long titles and truncates with an ellipsis", () => {
    expect(wrap("Fury leveling 10–30", 26, 2)).toEqual(["Fury leveling 10–30"]);
    const lines = wrap("An extremely long build title that goes on and on about arms warrior leveling", 26, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
  });

  it("features the deepest invested talents", () => {
    const picked = featuredTalents([
      { name: "a", tier: 0, rank: 5, max: 5 },
      { name: "b", tier: 6, rank: 1, max: 1 },
      { name: "c", tier: 3, rank: 0, max: 3 },
      { name: "d", tier: 3, rank: 2, max: 3 },
    ]);
    expect(picked.map((t) => t.name)).toEqual(["b", "d", "a"]);
  });

  it("renders a 1200×630 PNG with escaped text", () => {
    const svg = cardSvg({
      className: "Warrior",
      classColor: "#ce9248",
      title: `Fury <leveling> & "friends"`,
      split: "0/21/0",
      points: 21,
      author: "Kazrak",
      rating: { avg: 4.5, count: 2 },
      gameBuild: "70094",
      changedSince: 2,
      talents: [{ name: "Cruelty", rank: 5, max: 5, icon: null }],
    });
    expect(svg).toContain("Fury &#60;leveling&#62; &#38;");
    expect(svg).toContain("&#34;friends&#34;");
    expect(svg).not.toContain("<leveling>");
    const png = renderPng(resvg, svg, fonts);
    expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]); // PNG signature
    const view = new DataView(png.buffer, png.byteOffset);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([CARD_W, CARD_H]);
  });
});
