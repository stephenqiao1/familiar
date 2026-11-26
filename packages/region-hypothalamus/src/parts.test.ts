import { describe, expect, it } from "vitest";
import { AHEAD, createLookAhead, pressesAt } from "./ahead.js";
import { clockGain, readClock } from "./clock.js";
import { COMPETE, createTopDrive, desperateOf } from "./compete.js";
import { describeDrives } from "./describe.js";
import { DEFAULT_DRIVES, drivesProblem, weightOf } from "./settings.js";
import { createStress, loadOf, STRESS, stressGain } from "./stress.js";
import { afterShortage, createTargetMemory, driftBack, LEARNING, targetNow } from "./targets.js";

const reading = (name: string, level: number, more: { kind?: string; weight?: number; pressing?: number } = {}) => ({ name, kind: more.kind ?? "body", level, rank: 0, weight: more.weight ?? 1, pressing: more.pressing ?? level });

describe("targets: how much is enough", () => {
  const on = { targets: 1, learnTargets: 1 };
  it("is the base with nothing adjusting it, and with both strengths 0 whatever adjusts it", () => {
    expect(targetNow(8, [], 1, on)).toBe(8);
    expect(targetNow(8, [1.5], 2, { targets: 0, learnTargets: 0 })).toBe(8);
  });
  it("is the base × each adjustment that holds × what was learned", () => {
    expect(targetNow(8, [1.5], 1, on)).toBe(12);
    expect(targetNow(8, [1.5, 2], 1.25, on)).toBeCloseTo(30);
    expect(targetNow(8, [1.5], 1, { targets: 0.5, learnTargets: 1 })).toBe(10);
  });
  it("a shortage raises enough by a quarter, never past three times the base", () => {
    expect(afterShortage(1)).toBe(1.25);
    let times = 1;
    for (let i = 0; i < 20; i++) times = afterShortage(times);
    expect(times).toBe(LEARNING.most);
  });
  it("drifts back to the base over a few game days", () => {
    expect(driftBack(2, 0)).toBe(2);
    expect(driftBack(2, LEARNING.driftSeconds)).toBeCloseTo(1 + 1 / Math.E);
    expect(driftBack(2, 10 * LEARNING.driftSeconds)).toBeCloseTo(1, 3);
  });
  it("the memory keeps each need's multiplier with its time, and can be saved and loaded", () => {
    const memory = createTargetMemory();
    expect(memory.get("food", 0)).toBe(1);
    expect(memory.shortage("food", 1000)).toBe(1.25);
    expect(memory.shortage("food", 1000)).toBeCloseTo(1.5625);
    const loaded = createTargetMemory(memory.entries());
    expect(loaded.get("food", 1000)).toBeCloseTo(1.5625);
    expect(loaded.get("food", 1000 + LEARNING.driftSeconds * 1000)).toBeLessThan(1.3);
    expect(loaded.get("torches", 1000)).toBe(1);
  });
});

describe("looking ahead", () => {
  it("says nothing of a need that is steady or falling", () => {
    const ahead = createLookAhead();
    for (let t = 0; t <= 30; t++) expect(ahead.project("hunger", 0.4, t * 1000)).toBe(0.4);
    expect(ahead.project("hunger", 0.2, 31_000)).toBe(0.2);
  });
  it("projects a rising need a minute on at the rate of the last minute, capped at 1", () => {
    const ahead = createLookAhead();
    let projected = 0;
    // Rising 0.005 a second: 0.3 more in a minute.
    for (let t = 0; t <= 20; t++) projected = ahead.project("hunger", 0.2 + 0.005 * t, t * 1000);
    expect(projected).toBeCloseTo(0.3 + 0.3);
    for (let t = 21; t <= 60; t++) projected = ahead.project("hunger", Math.min(1, 0.2 + 0.02 * t), t * 1000);
    expect(projected).toBe(1);
  });
  it("what is known to be coming counts too, from the first look: the larger of it and the rate's projection", () => {
    const ahead = createLookAhead();
    expect(ahead.project("hunger", 0, 0, 0.5)).toBe(0.5);
    expect(ahead.project("hunger", 0.7, 1000, 0.5)).toBeGreaterThanOrEqual(0.7);
    expect(ahead.project("dark", 0.1, 0, null)).toBe(0.1);
  });
  it("presses at the level, or at 0.7 of the projection if that is more; at strength 0 always the level", () => {
    expect(pressesAt(0.2, 1, 1)).toBeCloseTo(AHEAD.share);
    expect(pressesAt(0.9, 1, 1)).toBe(0.9);
    expect(pressesAt(0.2, 1, 0)).toBe(0.2);
  });
});

describe("the body clock", () => {
  const day = (phase: number) => readClock({ phase, nightFrom: 0.6, daySeconds: 1200 });
  it("knows day from night and how far through the night it is", () => {
    expect(day(0.2)).toMatchObject({ night: false, nightProgress: 0, dusk: 0, dawn: 0 });
    expect(day(0.8).night).toBe(true);
    expect(day(0.8).nightProgress).toBeCloseTo(0.5);
  });
  it("dusk rises over the last three minutes of the day, dawn over the last three of the night", () => {
    expect(day(0.6 - 0.15).dusk).toBeCloseTo(0);
    expect(day(0.6 - 0.075).dusk).toBeCloseTo(0.5);
    expect(day(0.599).dusk).toBeGreaterThan(0.99);
    expect(day(1 - 0.075).dawn).toBeCloseTo(0.5);
  });
  it("a need of the night presses half as hard by day, one of the day half as hard by night, and the rest always in full", () => {
    expect(clockGain("night", day(0.2), 1)).toBe(0.5);
    expect(clockGain("night", day(0.8), 1)).toBe(1);
    expect(clockGain("day", day(0.8), 1)).toBe(0.5);
    expect(clockGain("day", day(0.2), 1)).toBe(1);
    expect(clockGain(undefined, day(0.8), 1)).toBe(1);
    expect(clockGain("day", day(0.8), 0)).toBe(1);
    expect(clockGain("day", null, 1)).toBe(1);
  });
});

describe("stress", () => {
  it("the load is the largest of its sources, not their sum", () => {
    expect(loadOf({ alarm: 0.6, threat: 0.5, pain: 0.2, poorVitals: 0.1 })).toEqual({ value: 0.6, by: "alarm" });
    expect(loadOf({ alarm: 0, threat: 0, pain: 0, poorVitals: 0 })).toEqual({ value: 0, by: "nothing" });
    // Fear is one more source: it loads the body before any harm has come.
    expect(loadOf({ alarm: 0.2, threat: 0, pain: 0, poorVitals: 0, fear: 0.5 })).toEqual({ value: 0.5, by: "fear" });
  });
  it("builds over about a minute under load and takes about five to fade", () => {
    const stress = createStress();
    let level = stress.update(1, 0);
    expect(level).toBe(0);
    for (let t = 1; t <= 60; t++) level = stress.update(1, t * 1000);
    expect(level).toBeCloseTo(1 - 1 / Math.E, 2);
    const peak = level;
    for (let t = 61; t <= 120; t++) level = stress.update(0, t * 1000);
    expect(level).toBeGreaterThan(0.8 * peak); // a minute later most of it is still there
    for (let t = 121; t <= 60 + STRESS.fadeSeconds; t++) level = stress.update(0, t * 1000);
    expect(level).toBeCloseTo(peak / Math.E, 2);
  });
  it("a need that can wait presses down to half under full stress; the others are untouched", () => {
    expect(stressGain(true, 1, 1)).toBe(0.5);
    expect(stressGain(true, 0.5, 1)).toBe(0.75);
    expect(stressGain(false, 1, 1)).toBe(1);
    expect(stressGain(true, 1, 0)).toBe(1);
  });
});

describe("competition", () => {
  it("a need of the body above 0.8 is desperate; one about safety, or one that weighs little, never is", () => {
    expect(desperateOf([reading("hunger", 0.9)])).toMatchObject({ name: "hunger" });
    expect(desperateOf([reading("hunger", 0.9)]).value).toBeCloseTo(0.5);
    expect(desperateOf([reading("hunger", 0.8)])).toEqual({ value: 0, name: null });
    expect(desperateOf([reading("health", 1, { kind: "safety" })]).name).toBeNull();
    expect(desperateOf([reading("tools", 1, { weight: 0.25 })]).name).toBeNull();
  });
  it("the top drive is the one pressing hardest by its weight, and nothing with nothing pressing", () => {
    const top = createTopDrive();
    expect(top.step([reading("hunger", 0), reading("rest", 0)], 0)).toBeNull();
    expect(top.step([reading("hunger", 0.4), reading("tools", 1, { weight: 0.25 })], 0)).toMatchObject({ name: "hunger", score: 0.4 });
  });
  it("is sticky: a rival takes over only by beating it by 0.1, or once it falls under 0.2", () => {
    const top = createTopDrive();
    top.step([reading("hunger", 0.5), reading("rest", 0.3)], 0);
    expect(top.step([reading("hunger", 0.5), reading("rest", 0.55)], 1000)?.name).toBe("hunger");
    expect(top.step([reading("hunger", 0.5), reading("rest", 0.61)], 2000)?.name).toBe("rest");
    expect(top.step([reading("hunger", 0.5), reading("rest", 0.45)], 3000)?.name).toBe("rest");
    expect(top.step([reading("hunger", 0.25), reading("rest", 0.19)], 4000)?.name).toBe("hunger");
  });
  it("does not flicker between two needs that press about the same", () => {
    const top = createTopDrive();
    const names = Array.from({ length: 40 }, (_, i) => top.step([reading("hunger", 0.5 + (i % 2 ? 0.04 : -0.04)), reading("rest", 0.5)], i * 1000)!.name);
    expect(new Set(names).size).toBe(1);
    expect(COMPETE.beatBy).toBe(0.1);
  });
});

describe("settings", () => {
  it("the defaults are fine, and hold the weights: danger 2, body 1, provision 0.25", () => {
    expect(drivesProblem(DEFAULT_DRIVES)).toBeNull();
    expect(DEFAULT_DRIVES.weights).toEqual({ danger: 2, body: 1, provision: 0.25 });
  });
  it("a strength outside 0 to 1, or a weight outside 0 to 5, is refused by name", () => {
    expect(drivesProblem({ ...DEFAULT_DRIVES, stress: 2 })).toContain("drives.stress");
    expect(drivesProblem({ ...DEFAULT_DRIVES, weight: { hunger: -1 } })).toContain("drives.weight.hunger");
  });
  it("a need takes its class's weight unless it is given its own by name", () => {
    expect(weightOf({ name: "danger", weighs: "danger" })).toBe(2);
    expect(weightOf({ name: "food_bar" })).toBe(1);
    expect(weightOf({ name: "food_bar" }, { ...DEFAULT_DRIVES, weight: { food_bar: 1.5 } })).toBe(1.5);
  });
});

describe("the planner's line", () => {
  it("says nothing with nothing to say", () => {
    expect(describeDrives(null)).toBeNull();
    expect(describeDrives({ readings: [], top: null, stress: 0.1 })).toBeNull();
  });
  it("names what the body wants most, a desperate need, stress, and night coming", () => {
    const soon = { name: "night_light", kind: "safety", level: 0, rank: 0, weight: 1, pressing: 0.35, projected: 0.5 };
    const line = describeDrives({ readings: [soon], top: { name: "food_bar", kind: "hunger", score: 0.9, since: 0 }, unmet: true, desperate: "food_bar", stress: 0.7, clock: { phase: 0.55, night: false, nightProgress: 0, dusk: 0.5, dawn: 0 } });
    expect(line).toBe("Your body: what it wants most is food bar (hunger, pressing 0.9, and nothing you know of relieves it); coming soon: night light (now 0.0, heading for 0.5); night falls in 2 min; food bar is desperate; it is worn down by stress: nothing that can wait is worth doing now.");
  });
});
