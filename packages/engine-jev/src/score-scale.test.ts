import { describe, expect, it } from "vitest";
import { levelToScore, scoreLevels } from "./score-scale.js";

const q = (min: number, max: number) => ({ kind: "score" as const, id: "s", prompt: "p", min, max });

describe("score scale", () => {
  it("uses one level per whole number for small integer ranges", () => {
    expect(scoreLevels(q(1, 5))).toEqual(["1", "2", "3", "4", "5"]);
    expect(levelToScore(q(1, 5), 2.5)).toBe(3.5);
  });

  it("uses 10 evenly spaced levels (Jev's maximum) for wide or fractional ranges", () => {
    expect(scoreLevels(q(0, 1))).toEqual(["0", "1"]);
    expect(scoreLevels(q(0, 9))).toHaveLength(10);
    expect(scoreLevels(q(0, 10))).toEqual(["0", "1.11", "2.22", "3.33", "4.44", "5.56", "6.67", "7.78", "8.89", "10"]);
    expect(scoreLevels(q(0, 0.5))).toHaveLength(10);
    expect(scoreLevels(q(-1, 1))).toEqual(["-1", "0", "1"]);
    expect(levelToScore(q(0, 10), 9)).toBe(10);
    expect(levelToScore(q(0, 10), 4.5)).toBe(5);
  });
});
