import type { Signal } from "@familiar/contracts";
import { describe, expect, it } from "vitest";
import { DEFAULT_LOCOMOTION, driveFrom, locomotionProblem, RESTING_DRIVE } from "./locomotion.js";

const signals = (levels: Record<string, number>): Record<string, Signal> => Object.fromEntries(Object.entries(levels).map(([name, value]) => [name, { value, source: "test", at: 0 }]));
const OFF = { speedFromAlarm: 0, speedFromDopamine: 0, cautionFromFocus: 0 };

describe("driveFrom", () => {
  it("with nothing shared, uses each signal's resting value", () => {
    expect(driveFrom({}, DEFAULT_LOCOMOTION)).toEqual({ speed: 0.4, caution: expect.closeTo(0.45) });
    expect(driveFrom({}, DEFAULT_LOCOMOTION, { dopamine: 0.7, focus: 0.2 })).toEqual({ speed: expect.closeTo(0.46), caution: expect.closeTo(0.36) });
  });

  it("alarm raises speed", () => {
    const at = (alarm: number) => driveFrom(signals({ alarm }), DEFAULT_LOCOMOTION).speed;
    expect([at(0), at(0.5), at(1)]).toEqual([0.4, 0.65, 0.9]);
  });

  it("dopamine raises speed above its middle and lowers it below", () => {
    const at = (dopamine: number) => driveFrom(signals({ dopamine }), DEFAULT_LOCOMOTION).speed;
    expect(at(0.9)).toBeCloseTo(0.52);
    expect(at(0.15)).toBeCloseTo(0.295);
  });

  it("hunger lowers speed", () => {
    expect(driveFrom(signals({ hunger: 1 }), DEFAULT_LOCOMOTION).speed).toBeCloseTo(0.1);
    expect(driveFrom(signals({ hunger: 1, alarm: 1 }), DEFAULT_LOCOMOTION).speed).toBeCloseTo(0.6);
  });

  it("focus raises caution, and high alarm removes it: a frightened bot does not tiptoe", () => {
    const at = (levels: Record<string, number>) => driveFrom(signals(levels), DEFAULT_LOCOMOTION).caution;
    expect([at({ focus: 0 }), at({ focus: 1 })]).toEqual([0.3, 0.6]);
    expect(at({ focus: 1, alarm: 0.6 })).toBe(0.6);
    expect(at({ focus: 1, alarm: 0.61 })).toBe(0);
  });

  it("unsteadiness raises caution: careful on a ledge even when focus is low, and even when frightened", () => {
    const at = (levels: Record<string, number>) => driveFrom(signals(levels), DEFAULT_LOCOMOTION).caution;
    expect(at({ focus: 0.5, unsteady: 0 })).toBeCloseTo(0.45);
    // A one-wide bridge (balance 0.5): past the 0.6 where the bot goes carefully, at any focus.
    expect(at({ focus: 0, unsteady: 0.5 })).toBeCloseTo(0.65);
    expect(at({ focus: 0.5, unsteady: 0.5 })).toBeCloseTo(0.8);
    // One edge (a cliff top, balance 0.85) is not enough to change how it walks.
    expect(at({ focus: 0.5, unsteady: 0.15 })).toBeLessThan(0.6);
    expect(at({ focus: 1, alarm: 1, unsteady: 0.5 })).toBeCloseTo(0.35);
    expect(at({ focus: 1, unsteady: 1 })).toBe(1);
  });

  it("stays within 0 to 1", () => {
    expect(driveFrom(signals({ alarm: 1, dopamine: 1 }), DEFAULT_LOCOMOTION).speed).toBe(1);
    expect(driveFrom(signals({ hunger: 1, dopamine: 0 }), DEFAULT_LOCOMOTION).speed).toBe(0);
  });

  it("with every strength at 0 gives the fixed defaults, whatever the signals say", () => {
    expect(driveFrom(signals({ alarm: 1, dopamine: 0.9, hunger: 1, focus: 1 }), OFF)).toEqual(RESTING_DRIVE);
    expect(RESTING_DRIVE).toEqual({ speed: 0.4, caution: 0.3 });
  });

  it("each strength scales only its own link", () => {
    const all = signals({ alarm: 0.5, dopamine: 0.9, focus: 1 });
    expect(driveFrom(all, { ...OFF, speedFromAlarm: 1 })).toEqual({ speed: 0.65, caution: 0.3 });
    expect(driveFrom(all, { ...OFF, speedFromDopamine: 0.5 })).toEqual({ speed: expect.closeTo(0.46), caution: 0.3 });
    expect(driveFrom(all, { ...OFF, cautionFromFocus: 1 })).toEqual({ speed: 0.4, caution: 0.6 });
  });
});

describe("locomotionProblem", () => {
  it("accepts the defaults and rejects anything outside 0 to 1", () => {
    expect(locomotionProblem(DEFAULT_LOCOMOTION)).toBeNull();
    expect(locomotionProblem({ ...DEFAULT_LOCOMOTION, speedFromAlarm: 1.5 })).toMatch(/locomotion.speedFromAlarm/);
  });
});
