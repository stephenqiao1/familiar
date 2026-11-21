import { describe, expect, it } from "vitest";
import { CUT_SHORT_HALF_LIFE, holdNow, LEAST_HOLD, reliefIsTelling, trustAfter, wantNow, withTheRest } from "./wanting.js";

describe("wantNow", () => {
  it("is what the expected relief would pay at the level the need stands at now", () => {
    const relief = () => 0.5;
    expect(wantNow({ hunger: 1 }, relief).want).toBeCloseTo(0.75); // 1² − 0.5²
    expect(wantNow({ hunger: 0.5 }, relief).want).toBeCloseTo(0.25); // all of it: 0.5² − 0
    expect(wantNow({ hunger: 0.2 }, relief).want).toBeCloseTo(0.04); // no more than the need itself
    expect(wantNow({ hunger: 0 }, relief)).toEqual({ want: 0, parts: {} });
  });

  it("adds the needs up, counting one made worse against, and names each part", () => {
    const { want, parts } = wantNow({ hunger: 1, health: 0, torches: 0.5 }, (need) => ({ hunger: 0.5, health: -0.4, torches: 0 })[need] ?? 0);
    expect(parts.hunger).toBeCloseTo(0.75);
    expect(parts.health).toBeCloseTo(-0.16);
    expect(parts).not.toHaveProperty("torches");
    expect(want).toBeCloseTo(0.59);
  });
});

describe("a run cut short", () => {
  it("is trusted in full the first time, and half as much after a few in a row", () => {
    expect(trustAfter(0)).toBe(1);
    expect(trustAfter(CUT_SHORT_HALF_LIFE)).toBeCloseTo(0.5);
    expect(trustAfter(40)).toBeLessThan(0.01);
  });

  it("is taken to have been going to deliver the trusted share of the rest, and never less than it got", () => {
    expect(withTheRest(0.1, 0.5, 1)).toBeCloseTo(0.5);
    expect(withTheRest(0.1, 0.5, 0.5)).toBeCloseTo(0.3);
    expect(withTheRest(0.1, 0.5, 0)).toBeCloseTo(0.1);
    expect(withTheRest(0.7, 0.5, 1)).toBeCloseTo(0.7);
  });
});

describe("reliefIsTelling", () => {
  it("believes a shortfall only if the need stood high enough to have shown the expected relief", () => {
    expect(reliefIsTelling(1, 0, 0.5)).toBe(true); // short of food, the chest gave nothing: it is empty
    expect(reliefIsTelling(0, 0, 0.5)).toBe(false); // stocked up, it gave nothing: says nothing about the chest
    expect(reliefIsTelling(0.2, 0.2, 0.5)).toBe(false);
    expect(reliefIsTelling(0.2, 0.2, 0.1)).toBe(true); // more than expected is always believed
  });
});

describe("holdNow", () => {
  const none = () => 0;
  it("keeps all of its hold with no need pressing, and loses most to a desperate need it does not serve", () => {
    expect(holdNow({ food: 0, health: 0 }, none)).toBe(1);
    expect(holdNow({ food: 0.25 }, none)).toBeGreaterThan(0.95);
    expect(holdNow({ food: 1, health: 0.2 }, none)).toBe(LEAST_HOLD);
  });

  it("keeps its hold if it is expected to relieve the need, and goes by the worst need left", () => {
    expect(holdNow({ food: 1 }, () => 1)).toBe(1);
    expect(holdNow({ food: 1, health: 1 }, (need) => (need === "food" ? 1 : 0))).toBe(LEAST_HOLD);
    // Expected to make the need worse: no worse than a need wholly unmet.
    expect(holdNow({ food: 0.9 }, () => -1)).toBe(LEAST_HOLD);
  });

  it("is scaled by strength, and off at 0", () => {
    expect(holdNow({ food: 1 }, none, 0)).toBe(1);
    expect(holdNow({ food: 1 }, none, 0.5)).toBeCloseTo(0.75);
  });
});
