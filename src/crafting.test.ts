import { describe, expect, it } from "vitest";
import { makersOf } from "./crafting";
import { difficulty, type ItemRef, type Profession, type Recipe } from "./data";
import { rawMaterials } from "./views/recipe";

const item = (id: number, name: string, count = 1): ItemRef => ({ id, name, count, q: 1, icon: "x" });
const recipe = (spell: number, creates: ItemRef | null, reagents: ItemRef[], extra: Partial<Recipe> = {}): Recipe => ({
  spell, name: creates?.name ?? `Recipe ${spell}`, yellow: 0, grey: 0, creates, reagents, ...extra,
});
const prof = (slug: string, kind: Profession["kind"], recipes: Recipe[], materials?: Profession["materials"]): Profession => ({
  id: 1, slug, name: slug, kind, icon: "x", desc: "", ranks: [], specs: [], categories: [], recipes, materials,
});

describe("skill-up colors", () => {
  const r = recipe(1, item(1, "Bar"), [], { learn: 100, yellow: 120, grey: 140 });
  it("follows the profession window: orange, yellow, green (midway), grey", () => {
    expect(difficulty(r, 90)).toBe("unlearnable");
    expect(difficulty(r, 100)).toBe("orange");
    expect(difficulty(r, 120)).toBe("yellow");
    expect(difficulty(r, 130)).toBe("green");
    expect(difficulty(r, 140)).toBe("grey");
  });
  it("never claims a recipe is unlearnable when only a trainer knows the skill", () => {
    expect(difficulty({ ...r, learn: undefined }, 1)).toBe("orange");
  });
});

describe("raw materials", () => {
  const ore = item(10, "Thorium Ore");
  const bar = item(11, "Thorium Bar");
  const arcanite = item(13, "Arcanite Bar");
  const scraps = item(20, "Ruined Leather Scraps");
  const light = item(21, "Light Leather");
  const lesser = item(30, "Lesser Essence");
  const greater = item(31, "Greater Essence");
  const profs = [
    prof("mining", "gathering", [recipe(100, bar, [item(10, "Thorium Ore", 1)])], { type: "Metal & Stone", items: [ore, bar] }),
    prof("alchemy", "primary", [
      recipe(200, arcanite, [item(11, "Thorium Bar", 1), item(12, "Arcane Crystal", 1)], { cooldown: 172800 }),
      recipe(201, bar, [item(13, "Arcanite Bar", 1)], { cooldown: 3600 }), // a made-up transmute back
    ]),
    prof("leatherworking", "primary", [recipe(300, light, [item(20, "Ruined Leather Scraps", 3)])]),
    prof("skinning", "gathering", [], { type: "Leather", items: [scraps, light] }),
    prof("enchanting", "primary", [recipe(400, greater, [item(30, "Lesser Essence", 3)]), recipe(401, item(30, "Lesser Essence", 3), [item(31, "Greater Essence", 1)])]),
  ];
  const makers = makersOf(profs);

  it("smelts bars rather than transmuting them", () => {
    expect(makers.get(bar.id)?.recipe.spell).toBe(100);
  });
  it("leaves gathered materials and two-way conversions alone", () => {
    expect(makers.has(light.id)).toBe(false);
    expect(makers.has(greater.id)).toBe(false);
    expect(makers.has(lesser.id)).toBe(false);
  });
  it("breaks crafted reagents down, scaled by how many crafts", () => {
    const reaper = recipe(500, item(50, "Arcanite Reaper"), [item(13, "Arcanite Bar", 20), item(21, "Light Leather", 2)]);
    const raw = [...rawMaterials(reaper, 2, makers).values()].map((i) => [i.name, i.count]);
    expect(raw).toEqual([
      ["Thorium Ore", 40],
      ["Arcane Crystal", 40],
      ["Light Leather", 4],
    ]);
  });
});
