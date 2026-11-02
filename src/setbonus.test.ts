import { describe, expect, it } from "vitest";
import { parseBonus } from "./setbonus";

describe("set bonus parsing", () => {
  it("counts bonuses that say exactly what they add", () => {
    expect(parseBonus("+20 Stamina.")).toEqual({ stats: { sta: 20 }, pct: {} });
    expect(parseBonus("+40 Attack Power.")).toEqual({ stats: { ap: 40 }, pct: {} });
    expect(parseBonus("+10 All Resistances.")?.stats).toMatchObject({ fireres: 10, shadowres: 10 });
    expect(parseBonus("Increases healing done by up to 44 and damage done by up to 15 for all magical spells and effects.")?.stats).toEqual({ healing: 44, spelldmg: 15 });
    expect(parseBonus("Improves your chance to hit by 1.0%.")?.pct).toEqual({ hit: 1 });
    expect(parseBonus("Improves your chance to get a critical strike with spells by 2.0%.")?.pct).toEqual({ spellCrit: 2 });
    expect(parseBonus("Improves your chance to get a critical strike with melee attacks by 1.0%.")?.pct).toEqual({ crit: 1 });
  });

  it("leaves procs and ability tweaks out of the numbers", () => {
    expect(parseBonus("Reduces the cooldown of your Blink spell by 1.5 sec.")).toBeNull();
    expect(parseBonus("Improves your chance to get a critical strike with all Shock spells by 2%.")).toBeNull();
    expect(parseBonus("Chance on melee attack to restore 20 Energy.")).toBeNull();
    expect(parseBonus("Increased Defense +7.")).toBeNull();
  });
});
