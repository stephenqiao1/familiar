import { describe, expect, it } from "vitest";
import { needChangeReward } from "./need-change.js";

describe("needChangeReward", () => {
  it("pays for a need that fell, more the bigger the need was", () => {
    expect(needChangeReward(1, 0)).toBe(1);
    expect(needChangeReward(0.9, 0.5)).toBeGreaterThan(needChangeReward(0.5, 0.1));
    expect(needChangeReward(0.1, 0)).toBeCloseTo(0.01);
  });

  it("charges for a need that rose, exactly what falling back pays", () => {
    expect(needChangeReward(0.2, 0.7)).toBeLessThan(0);
    expect(needChangeReward(0.2, 0.7) + needChangeReward(0.7, 0.2)).toBeCloseTo(0);
    expect(needChangeReward(0.4, 0.4)).toBe(0);
  });

  it("adds up to the same over small steps as over one big one", () => {
    const steps = needChangeReward(1, 0.75) + needChangeReward(0.75, 0.5) + needChangeReward(0.5, 0.25) + needChangeReward(0.25, 0);
    expect(steps).toBeCloseTo(needChangeReward(1, 0));
  });
});
