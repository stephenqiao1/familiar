import { describe, expect, it } from "vitest";
import { DEFAULT_PERSONALITY, personalityProblem } from "./personality.js";

describe("personalityProblem", () => {
  it("accepts the default and the trait extremes", () => {
    expect(personalityProblem(DEFAULT_PERSONALITY)).toBeNull();
    expect(personalityProblem({ restingDA: 0.35, learningRate: 0.05, noveltyBonus: 0.2 })).toBeNull();
    expect(personalityProblem({ restingDA: 0.65, learningRate: 0.2, noveltyBonus: 1 })).toBeNull();
  });

  it("rejects values outside their range", () => {
    expect(personalityProblem({ ...DEFAULT_PERSONALITY, restingDA: 0.1 })).toMatch(/restingDA/);
    expect(personalityProblem({ ...DEFAULT_PERSONALITY, learningRate: 0 })).toMatch(/learningRate/);
    expect(personalityProblem({ ...DEFAULT_PERSONALITY, noveltyBonus: -1 })).toMatch(/noveltyBonus/);
    expect(personalityProblem({ ...DEFAULT_PERSONALITY, restingDA: Number.NaN })).toMatch(/restingDA/);
  });
});
