import { describe, expect, it } from "vitest";
import type { MovementFacts } from "../movements.js";
import { estimateSeconds, expectedOver, fixedPace, lateAfter, stumbleScale, type LearnedPace } from "./learned-pace.js";

const STONE: MovementFacts = { pattern: "walk", gait: "jog", ground: "stone", surface: "solid" };
const WATER: MovementFacts = { pattern: "swim", gait: "jog", ground: "water", surface: "liquid", inWater: true };
const MUD: MovementFacts = { pattern: "walk", gait: "jog", ground: "mud", surface: "slow" };
/** What has been learned: stone a little quicker than the fixed speed, water much quicker than the fixed swim, mud three times slower than a jog. */
const KNOWN: Record<string, { value: number; spread: number }> = { stone: { value: 0.19, spread: 0.02 }, water: { value: 0.33, spread: 0.03 }, mud: { value: 0.6, spread: 0.06 } };
const learned = (strength = 1, known = KNOWN): LearnedPace => ({ pace: (_pattern, facts) => known[facts.ground ?? ""] ?? null, strengths: () => ({ estimates: strength, late: strength, pace: strength }) });
const NONE = { blocks: 0, facts: STONE };

describe("a journey's estimate", () => {
  it("is the fixed speed with nothing learned, at strength 0, and with no cerebellum", () => {
    const fixed = 30 * fixedPace("walk", "jog");
    expect(estimateSeconds(30, STONE, "jog", undefined).seconds).toBe(fixed);
    expect(estimateSeconds(30, STONE, "jog", learned(0)).seconds).toBe(fixed);
    expect(estimateSeconds(30, { ...STONE, ground: "sand" }, "jog", learned()).seconds).toBe(fixed);
  });

  it("comes from the learned pace on the ground it starts on", () => {
    expect(estimateSeconds(30, WATER, "jog", learned()).seconds).toBeCloseTo(30 * 0.33, 5);
    expect(estimateSeconds(30, WATER, "jog", learned()).fixed).toBeCloseTo(15, 5);
    expect(estimateSeconds(30, WATER, "jog", learned(0.5)).seconds).toBeCloseTo((15 + 30 * 0.33) / 2, 5);
  });
});

describe("late", () => {
  it("is twice the estimate by the fixed rule: with no cerebellum, at strength 0, and over ground with no trusted model", () => {
    const sand = [{ facts: { ...STONE, ground: "sand" }, blocks: 30, seconds: 6 }];
    expect(lateAfter(6, expectedOver(sand, NONE, "jog", undefined), 4, undefined)).toBe(12);
    expect(lateAfter(6, expectedOver(sand, NONE, "jog", learned(0)), 4, learned(0))).toBe(12);
    expect(lateAfter(6, expectedOver(sand, NONE, "jog", learned()), 4, learned())).toBeCloseTo(12, 5);
  });

  it("is the learned time over the ground crossed and three spreads", () => {
    const crossed = [
      { facts: STONE, blocks: 20, seconds: 4 },
      { facts: WATER, blocks: 10, seconds: 3.3 },
    ];
    const expected = expectedOver(crossed, NONE, "jog", learned());
    expect(expected).toMatchObject({ trusted: true });
    expect(expected.seconds).toBeCloseTo(20 * 0.19 + 10 * 0.33, 5);
    // One spread is never under a tenth of the pace.
    expect(expected.spread).toBeCloseTo(20 * 0.02 + 10 * 0.033, 5);
    expect(lateAfter(6, expected, 4, learned())).toBeCloseTo(expected.seconds + 3 * expected.spread, 5);
  });

  it("a crossing of slow ground is not late by the learned rule where the fixed rule calls it late", () => {
    const expected = expectedOver([{ facts: MUD, blocks: 30, seconds: 18 }], NONE, "jog", learned());
    const fixedEstimate = 30 * fixedPace("walk", "jog");
    expect(18).toBeGreaterThan(lateAfter(fixedEstimate, expected, 4, undefined));
    expect(18).toBeLessThan(lateAfter(fixedEstimate, expected, 4, learned()));
  });

  it("ground that was not measured is priced as the ground the journey started on", () => {
    const expected = expectedOver([], { blocks: 10, facts: WATER }, "jog", learned());
    expect(expected.seconds).toBeCloseTo(3.3, 5);
  });
});

describe("the stumble check's allowance", () => {
  it("is unchanged with nothing learned or at strength 0", () => {
    expect(stumbleScale(MUD, "jog", undefined)).toBe(1);
    expect(stumbleScale(MUD, "jog", learned(0))).toBe(1);
    expect(stumbleScale({ ...STONE, ground: "sand" }, "jog", learned())).toBe(1);
  });

  it("is smaller on ground the body has learned is slow, within bounds", () => {
    expect(stumbleScale(MUD, "jog", learned())).toBe(0.5);
    expect(stumbleScale(STONE, "jog", learned())).toBeCloseTo(0.2 / 0.19, 5);
    expect(stumbleScale(WATER, "jog", learned())).toBe(1.5);
  });
});
