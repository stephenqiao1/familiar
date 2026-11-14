import { describe, expect, it } from "vitest";
import { createMood } from "./mood.js";

describe("createMood", () => {
  it("is neutral with no surprises", () => {
    expect(createMood().level(0)).toBe(0);
  });

  it("averages recent surprises, good and bad", () => {
    const mood = createMood();
    mood.feel(0.8, 0);
    expect(mood.level(0)).toBeCloseTo(0.8);
    mood.feel(-0.4, 0);
    expect(mood.level(0)).toBeCloseTo(0.2);
  });

  it("fades back toward neutral over minutes, and stays within -1 to 1", () => {
    const mood = createMood();
    mood.feel(-5, 0);
    expect(mood.level(0)).toBe(-1);
    expect(Math.abs(mood.level(3_600_000))).toBeLessThan(0.01);
  });
});
