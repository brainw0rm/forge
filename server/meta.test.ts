import { describe, expect, it } from "vitest";
import type { Env } from "./http";
import { itemPageMeta } from "./meta";

const files: Record<string, unknown> = {
  "/data/items/db/meta.json": { shards: 128 },
  "/data/items/db/d/76.json": {
    "12620": {
      name: "Enchanted Thorium Helm", q: 4, ilvl: 62, req: 57, slot: 1, armor: 600, stats: { str: 20, crit: 14 },
      spells: [{ on: "equip", text: "Increases your chance\nto block by 2%." }], status: "changed",
    },
  },
};
const env = {
  ASSETS: {
    fetch: async (url: string) => {
      const body = files[new URL(url).pathname];
      return body ? new Response(JSON.stringify(body)) : new Response("not found", { status: 404 });
    },
  },
} as unknown as Env;

describe("item link previews", () => {
  it("summarizes the item like its tooltip", async () => {
    const meta = await itemPageMeta(new Request("https://forever-forge.com/items/12620"), env);
    expect(meta?.title).toBe("Enchanted Thorium Helm");
    expect(meta?.description).toBe(
      "Epic Head · item level 62 · requires level 57 · 600 armor · +20 Strength · +14 Critical Strike Rating. Changed since Classic Era. Equip: Increases your chance to block by 2%.",
    );
  });

  it("falls back to the default page for unknown items and other paths", async () => {
    expect(await itemPageMeta(new Request("https://forever-forge.com/items/99"), env)).toBeNull();
    expect(await itemPageMeta(new Request("https://forever-forge.com/items"), env)).toBeNull();
  });
});
