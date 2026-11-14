import { describe, expect, it } from "vitest";
import { skillValue } from "./effort.js";

const fresh = { expected: 0, benefit: 1, cost: 1 };
const richButCostly = { expected: 0, benefit: 2, cost: 1.5 };
const cheap = { expected: 0, benefit: 0.8, cost: 0.2 };

describe("skillValue", () => {
  it("is 0 for a skill never learned about, at rest", () => {
    expect(skillValue(fresh, 0.5)).toBe(0);
  });

  it("is benefit minus cost at rest", () => {
    expect(skillValue(richButCostly, 0.5)).toBeCloseTo(0.5);
  });

  it("favours costly but rewarding skills when DA is high, cheap ones when low", () => {
    expect(skillValue(richButCostly, 0.9)).toBeGreaterThan(skillValue(cheap, 0.9));
    expect(skillValue(cheap, 0.1)).toBeGreaterThan(skillValue(richButCostly, 0.1));
  });
});
