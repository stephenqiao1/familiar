import { describe, expect, it } from "vitest";
import { needDropReward } from "./need-drop.js";

describe("needDropReward", () => {
  it("is worth more when the need was bigger", () => {
    expect(needDropReward(0.9, 0.5)).toBeCloseTo(0.36);
    expect(needDropReward(0.1, 0)).toBeCloseTo(0.01);
  });

  it("is 0 when the need rose or stayed the same", () => {
    expect(needDropReward(0.2, 0.6)).toBe(0);
    expect(needDropReward(0.5, 0.5)).toBe(0);
  });
});
