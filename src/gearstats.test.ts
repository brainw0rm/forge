import { describe, expect, it } from "vitest";
import { characterSheet, CLASS_SHEETS, fmtStat, sheetFor } from "./gearstats";

const defaults = (cls: string) => Object.fromEntries(CLASS_SHEETS[cls].params.map((p) => [p.key, p.value]));
const inputs = (extra: Record<string, number> = {}) => {
  const vars: Record<string, number> = { level: 60 };
  for (const k of ["str", "agi", "sta", "int", "spi", "armor", "ap", "rap", "crit", "hit", "sp", "spelldmg", "healing", "mp5"]) vars[`gear_${k}`] = 0;
  for (const k of ["str", "agi", "sta", "int", "spi"]) vars[`base_${k}`] = 0;
  for (const w of ["mh", "oh", "ranged"]) Object.assign(vars, { [`${w}_min`]: 0, [`${w}_max`]: 0, [`${w}_speed`]: 0, [`${w}_dps`]: 0, [`${w}_equipped`]: 0 });
  return { ...vars, ...extra };
};
const row = (sheet: ReturnType<typeof characterSheet>, key: string) => [...sheet.groups.values()].flat().find((r) => r.key === key)!;

describe("gear sandbox character sheet", () => {
  it("works out a warrior's numbers from gear, base stats and the rules of thumb", () => {
    const s = characterSheet("warrior", sheetFor("warrior", defaults("warrior")), inputs({ base_str: 120, gear_str: 18, base_agi: 80, gear_crit: 28, gear_hit: 20 }));
    expect(row(s, "str").value).toBe(138);
    expect(row(s, "attack_power").value).toBe(60 * 3 - 20 + 138 * 2);
    expect(fmtStat(row(s, "crit_pct"))).toBe("6.00%"); // 80 / 20 + 28 / 14
    expect(fmtStat(row(s, "hit_pct"))).toBe("2.00%");
    expect(row(s, "crit_pct").how).toBe("20 Agility or 14 crit rating = 1%");
    expect(s.errors).toEqual([]);
  });

  it("follows changed rules of thumb", () => {
    const s = characterSheet("warrior", sheetFor("warrior", { ...defaults("warrior"), agi_per_crit: 40 }), inputs({ base_agi: 80 }));
    expect(fmtStat(row(s, "crit_pct"))).toBe("2.00%");
    expect(row(s, "crit_pct").how).toContain("40 Agility");
  });

  it("explains a missing weapon DPS instead of showing a number", () => {
    const empty = characterSheet("warrior", sheetFor("warrior", defaults("warrior")), inputs());
    expect(row(empty, "white_dps")).toMatchObject({ value: null, how: "Equip a main-hand weapon" });
    const noData = characterSheet("warrior", sheetFor("warrior", defaults("warrior")), inputs({ mh_equipped: 1 }));
    expect(row(noData, "white_dps").how).toMatch(/no damage data/);
  });

  it("lists hand-written extras under Your formulas and reports broken lines", () => {
    const sheet = `${sheetFor("mage", defaults("mage"))}\ndouble_mana = mana * 2\nbad = nope + 1`;
    const s = characterSheet("mage", sheet, inputs({ base_int: 100 }));
    expect(s.groups.get("Your formulas")).toEqual([{ key: "double_mana", label: "double_mana", value: 3000 }]);
    expect(s.errors.map((e) => e.error)).toEqual(["Unknown name “nope”"]);
  });

  it("has a sheet for every class that runs without errors", () => {
    for (const cls of Object.keys(CLASS_SHEETS)) expect(characterSheet(cls, sheetFor(cls, defaults(cls)), inputs()).errors).toEqual([]);
  });
});
