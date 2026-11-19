import { describe, expect, it } from "vitest";
import { asleepLevel, bandOf, depthOf, rateOf, restful, sleepDrive, sleepyOf, stepArousal, targetOf, wakeDrive, wakes } from "./arousal.js";

const calm = { alarm: 0, threat: 0, startle: 0, pain: 0, urge: 0 };
/** Runs arousal toward a target for some seconds, half a second at a time. */
const run = (from: number, target: number, seconds: number, groggy = false) => {
  let a = from;
  for (let t = 0; t < seconds; t += 0.5) a = stepArousal(a, target, 0.5, groggy);
  return a;
};

describe("wakeDrive", () => {
  it("is the largest of alarm, threat, startle, pain and urge, and says which", () => {
    expect(wakeDrive(calm)).toEqual({ value: 0, by: "nothing" });
    expect(wakeDrive({ ...calm, alarm: 0.4, urge: 0.7 })).toEqual({ value: 0.7, by: "urge" });
    expect(wakeDrive({ ...calm, threat: 1, pain: 0.5 }).value).toBe(1);
  });
  it("adds a little for novelty and for a demanding skill", () => {
    expect(wakeDrive({ ...calm, novel: true })).toEqual({ value: 0.15, by: "novelty" });
    expect(wakeDrive({ ...calm, alarm: 0.2, novel: true, demanding: true }).value).toBeCloseTo(0.5);
  });
});

describe("the arousal level", () => {
  it("alarm raises it fast: nearly there within a second", () => {
    const target = targetOf(wakeDrive({ ...calm, alarm: 0.8 }).value, 0);
    expect(target).toBeCloseTo(0.9);
    expect(run(0.5, target, 1)).toBeGreaterThan(0.85);
  });
  it("calm lets it fall slowly: about 20 seconds", () => {
    expect(run(0.9, 0.5, 2)).toBeGreaterThan(0.75);
    expect(run(0.9, 0.5, 20)).toBeLessThan(0.53);
  });
  it("sleep pressure at night lowers it; by day it lowers it less", () => {
    const tired = 0.4;
    const still = { safe: true, idle: true, recovering: false };
    const night = targetOf(0, sleepDrive(sleepyOf(tired, true, false), restful({ ...still, night: true })));
    const day = targetOf(0, sleepDrive(sleepyOf(tired, false, false), restful({ ...still, night: false })));
    expect(night).toBeLessThan(0.2);
    expect(day).toBeGreaterThan(night + 0.2);
    expect(day).toBeLessThan(0.5);
  });
  it("names its bands", () => {
    expect([0.05, 0.2, 0.5, 0.8, 0.95].map(bandOf)).toEqual(["asleep", "drowsy", "awake", "alert", "over-aroused"]);
  });
  it("climbs slowly while groggy: about 10 seconds", () => {
    expect(run(0.25, 0.5, 2, true)).toBeLessThan(0.4);
    expect(run(0.25, 0.5, 10, true)).toBeGreaterThan(0.47);
  });
});

describe("sleepyOf", () => {
  it("is tiredness raised at night and lowered by day, and none while danger is coming", () => {
    expect(sleepyOf(0.33, true, false)).toBeCloseTo(0.68);
    expect(sleepyOf(0.33, false, false)).toBeCloseTo(0.13);
    expect(sleepyOf(0, true, false)).toBeLessThan(0.5);
    expect(sleepyOf(0.9, true, true)).toBe(0);
    expect(sleepyOf(0.33, true, false, 0)).toBe(0);
  });
});

describe("depth and waking", () => {
  it("sleep is deep for the first third of the night and light toward morning", () => {
    expect(depthOf(0)).toBe(0.9);
    expect(depthOf(0.3)).toBe(0.9);
    expect(depthOf(0.66)).toBeCloseTo(0.65, 1);
    expect(depthOf(1)).toBeCloseTo(0.4);
    expect(asleepLevel(0.9)).toBeLessThan(asleepLevel(0.4));
    expect(bandOf(asleepLevel(0.4))).toBe("asleep");
  });
  it("a weak event wakes a light sleeper and not a deep one; a heavier sleeper needs more", () => {
    expect(wakes(0.3, depthOf(0.1))).toBe(false);
    expect(wakes(0.3, depthOf(1))).toBe(true);
    expect(wakes(0.6, depthOf(0.1))).toBe(true);
    expect(wakes(0.6, depthOf(0.1), 1)).toBe(false);
  });
});

describe("rateOf", () => {
  it("is 0 asleep, about 0.3 drowsy, 1 awake, and smooth in between", () => {
    expect(rateOf(0.05, 0, true)).toBe(0);
    expect(rateOf(0.35, 0, false)).toBeCloseTo(0.3);
    expect(rateOf(0.5, 0, false)).toBe(1);
    expect(rateOf(0.25, 0, false)).toBeCloseTo(0.15);
    expect(rateOf(0.4, 0, false)).toBeGreaterThan(0.3);
    expect(rateOf(0.4, 0, false)).toBeLessThan(1);
  });
  it("anything urgent opens it fully at once", () => {
    expect(rateOf(0.2, 0.6, false)).toBe(1);
    expect(rateOf(0.05, 0.6, true)).toBe(1);
  });
});
