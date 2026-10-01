import { describe, expect, it } from "vitest";
import { evaluate, parse, runSheet } from "./formula";

describe("formula language", () => {
  it("follows arithmetic precedence and functions", () => {
    expect(evaluate(parse("1 + 2 * 3"), {})).toBe(7);
    expect(evaluate(parse("(1 + 2) * 3"), {})).toBe(9);
    expect(evaluate(parse("-2 * -3"), {})).toBe(6);
    expect(evaluate(parse("max(1, str / 2, 4)"), { str: 10 })).toBe(5);
    expect(evaluate(parse("round(2.5) + floor(1.9)"), {})).toBe(4);
  });

  it("rejects anything that isn't a formula", () => {
    expect(() => parse("alert(1)")).toThrow(/Unknown function/);
    expect(() => parse("a = 1")).toThrow();
    expect(() => parse("constructor.constructor")).toThrow();
    expect(() => evaluate(parse("nope + 1"), {})).toThrow(/Unknown name/);
    expect(() => parse("(1 + 2")).toThrow(/Expected/);
    expect(() => evaluate(parse("1 / (2 - 2)"), {})).toThrow(/Division by zero/);
  });

  it("evaluates a sheet line by line with comments and per-line errors", () => {
    const { lines, vars } = runSheet(
      ["# base", "str = base_str + gear_str  # total", "ap = str * 2", "bad = str +", "crit = agi / 20"].join("\n"),
      { base_str: 100, gear_str: 50, agi: 60 },
    );
    expect(vars.ap).toBe(300);
    expect(vars.crit).toBe(3);
    expect(lines.find((l) => l.name === "str")).toMatchObject({ value: 150, comment: "total" });
    expect(lines.find((l) => l.name === "bad")!.error).toBeTruthy();
    expect(vars.bad).toBeUndefined();
  });
});
