import { describe, expect, it } from "vitest";
import { brakeFactor, giveUpFactor, planningHorizon } from "./effects.js";

describe("giveUpFactor", () => {
  it("waits longest with high patience and a good chance, less with a poor chance, least with low patience", () => {
    const patientLikely = giveUpFactor(0.9, 0.9, 1);
    const patientUnlikely = giveUpFactor(0.9, 0.1, 1);
    const impatientUnlikely = giveUpFactor(0.1, 0.1, 1);
    expect(patientLikely).toBeGreaterThan(patientUnlikely);
    expect(patientUnlikely).toBeGreaterThan(impatientUnlikely);
    expect(patientLikely).toBeCloseTo(1.4 * 1.4);
  });

  it("changes nothing at neutral patience with an unknown chance, or when off", () => {
    expect(giveUpFactor(0.5, 0.5, 1)).toBe(1);
    expect(giveUpFactor(0.9, 0.9, 0)).toBe(1);
  });
});

describe("brakeFactor", () => {
  it("scores a risky skill lower at patience 0.9 than at 0.1", () => {
    expect(brakeFactor(0.9, 1)).toBeCloseTo(0.66);
    expect(brakeFactor(0.1, 1)).toBeCloseTo(1.14);
  });

  it("is 1 when off", () => {
    expect(brakeFactor(0.9, 0)).toBe(1);
  });
});

describe("planningHorizon", () => {
  it("tells the planner to think short when patience is low, with 2 steps", () => {
    expect(planningHorizon(0.05, 1)).toEqual({ instruction: expect.stringMatching(/^Focus on immediate needs/), maxSteps: 2 });
  });

  it("allows longer projects when patience is high, with up to 5 steps", () => {
    expect(planningHorizon(0.95, 1)).toEqual({ instruction: expect.stringMatching(/^You can afford longer projects/), maxSteps: 5 });
  });

  it("adds no instruction in the middle, and nothing at all when off", () => {
    expect(planningHorizon(0.5, 1)).toEqual({ maxSteps: 4 });
    expect(planningHorizon(0.05, 0)).toEqual({});
  });
});
