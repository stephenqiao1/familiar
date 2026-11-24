import { describe, expect, it } from "vitest";
import { DEFAULT_COLLICULUS, type Features } from "./colliculus-settings.js";
import { LOST_IN_DARK, leftInLight } from "./darkness.js";
import { fieldOf, jumpTo } from "./field.js";
import { BRAKE, brakeOf } from "./fixation.js";
import { leanOf, type LeanFacts } from "./lean.js";
import { createOrienting } from "./orienting.js";
import { boostOf, WATCH_BOOST } from "./priority.js";
import { partsOf, salienceOf } from "./salience.js";

// The small rules of the two-dimensional map, each with plain numbers.

const none: Features = { suddenness: 0, motion: 0, looming: 0, nearness: 0, loudness: 0, touch: 0 };

describe("fields", () => {
  it("more than 20 degrees up is the upper field, more than 20 down the lower, else level", () => {
    expect([90, 21, 20, 0, -20, -21, -90].map(fieldOf)).toEqual(["upper", "upper", "level", "level", "level", "lower", "lower"]);
  });

  it("the jump is sideways by the angle, and up or down from where the head points", () => {
    expect(jumpTo({ angle: -40, elevation: 30 }, 0)).toEqual({ sideways: -40, upDown: 30 });
    expect(jumpTo({ angle: 10, elevation: 30 }, 45)).toEqual({ sideways: 10, upDown: -15 });
  });
});

describe("sight in the dark", () => {
  it("a still thing loses more in the dark than a moving or a looming one", () => {
    const lost = (feature: keyof Features) => 1 - leftInLight(feature, 0, 1);
    expect(lost("nearness")).toBeGreaterThan(lost("motion"));
    expect(lost("motion")).toBeGreaterThan(lost("looming"));
    expect(leftInLight("nearness", 1, 1)).toBe(1);
    expect(leftInLight("nearness", 0, 0)).toBe(1);
    expect(LOST_IN_DARK.loudness).toBeUndefined();
  });

  it("darkness lowers a still thing's salience more than a moving one's, and scales only what is seen", () => {
    const sum = (f: Features, via: "sight" | "sound", light: number) => Object.values(partsOf(f, via, DEFAULT_COLLICULUS, light)).reduce((a, b) => a + b, 0);
    const still = { ...none, nearness: 1 };
    const moving = { ...none, motion: 1 };
    expect(sum(still, "sight", 1)).toBeCloseTo(salienceOf(still, "sight", DEFAULT_COLLICULUS));
    expect(sum(still, "sight", 0) / sum(still, "sight", 1)).toBeCloseTo(0.2);
    expect(sum(moving, "sight", 0) / sum(moving, "sight", 1)).toBeCloseTo(0.7);
    const loud = { ...none, loudness: 1 };
    expect(sum(loud, "sound", 0)).toBe(sum(loud, "sound", 1));
    expect(Object.values(partsOf(still, "sight", { ...DEFAULT_COLLICULUS, darkness: 0 }, 0)).reduce((a, b) => a + b, 0)).toBeCloseTo(0.25);
  });
});

describe("priority", () => {
  const on = { topDown: 1, wants: 1 };
  it("the boost is WATCH_BOOST times the larger of watched and wanted", () => {
    expect(boostOf(true, 0, on)).toEqual({ boost: WATCH_BOOST, from: "watched" });
    expect(boostOf(false, 0.5, on)).toEqual({ boost: WATCH_BOOST * 0.5, from: "wanted" });
    expect(boostOf(true, 0.5, on).boost).toBe(WATCH_BOOST);
    expect(boostOf(false, 0, on)).toEqual({ boost: 0, from: null });
  });

  it("with wants at 0 only a watched kind is boosted", () => {
    expect(boostOf(false, 1, { topDown: 1, wants: 0 })).toEqual({ boost: 0, from: null });
    expect(boostOf(true, 1, { topDown: 1, wants: 0 }).boost).toBe(WATCH_BOOST);
  });
});

describe("the brake", () => {
  it("adds 0.3 while something is fixated, and never takes the threshold more than 0.4 up with a demanding skill", () => {
    expect(brakeOf(true, 0, 1)).toBeCloseTo(BRAKE.extra);
    expect(brakeOf(true, 0.3, 1)).toBeCloseTo(0.1);
    expect(0.3 + brakeOf(true, 0.3, 1)).toBeLessThanOrEqual(BRAKE.most + 1e-9);
    expect(brakeOf(false, 0, 1)).toBe(0);
    expect(brakeOf(true, 0, 0)).toBe(0);
  });
});

describe("the lean", () => {
  const facts = (over: Partial<LeanFacts>): LeanFacts => ({ field: "level", looming: 0, across: 0, closing: 0, safetyPresses: false, ...over });
  it("growing fast in the upper field: avoid", () => {
    expect(leanOf(facts({ field: "upper", looming: 0.75, closing: 6 }))).toBe("avoid");
    // The same thing at eye level is looming as ever, with no lean.
    expect(leanOf(facts({ field: "level", looming: 0.75, closing: 6 }))).toBeNull();
  });

  it("moving across the upper field without coming nearer: freeze", () => {
    expect(leanOf(facts({ field: "upper", across: 5, closing: 0 }))).toBe("freeze");
    expect(leanOf(facts({ field: "upper", across: 5, closing: -2 }))).toBe("freeze");
    expect(leanOf(facts({ field: "upper", across: 0.2 }))).toBeNull();
    expect(leanOf(facts({ field: "level", across: 5 }))).toBeNull();
  });

  it("small, slow, on the ground, close and not coming at the body: approach", () => {
    const small = { height: 0.9, dist: 4, across: 1 };
    expect(leanOf(facts({ ...small }))).toBe("approach");
    expect(leanOf(facts({ ...small, field: "lower" }))).toBe("approach");
    expect(leanOf(facts({ ...small, height: 1.95 }))).toBeNull(); // too big
    expect(leanOf(facts({ ...small, across: 5 }))).toBeNull(); // too fast
    expect(leanOf(facts({ ...small, dist: 12 }))).toBeNull(); // too far
    expect(leanOf(facts({ ...small, closing: 3 }))).toBeNull(); // coming at the body
    expect(leanOf(facts({ dist: 4, across: 1 }))).toBeNull(); // size not known
    expect(leanOf(facts({ ...small, across: 0 }))).toBeNull(); // not moving: a still block is not a small animal
  });

  it("no approach while a need for safety presses; nothing by default", () => {
    expect(leanOf(facts({ height: 0.9, dist: 4, across: 1, safetyPresses: true }))).toBeNull();
    expect(leanOf(facts({}))).toBeNull();
  });
});

describe("the orienting signal", () => {
  it("is the winner's strength, and fades to nothing in half a second", () => {
    const signal = createOrienting();
    expect(signal.level(0)).toBe(0);
    signal.fire(0.8, 1000);
    expect(signal.level(1000)).toBeCloseTo(0.8);
    expect(signal.level(1250)).toBeCloseTo(0.4);
    expect(signal.level(1500)).toBe(0);
    signal.fire(3, 2000);
    expect(signal.level(2000)).toBe(1);
  });
});
