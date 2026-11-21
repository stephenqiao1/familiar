import { describe, expect, it } from "vitest";
import { fakeState, type StatePatch } from "../encode/state.test-helper.js";
import { effortSpent } from "./effort-spent.js";

const at = (x: number, self: StatePatch["self"] = {}, current: StatePatch["current"] = { skill: "go_to", target: null, secondsRunning: 1 }) => ({
  self: { position: { x, y: 63, z: 0 }, ...self },
  current,
});
/** The effort between two states half a second apart (or `ms`). */
const spent = (before: StatePatch, after: StatePatch, ms = 500) => effortSpent({ before: fakeState(before, 0), after: fakeState(after, ms) }, (skill) => skill !== "idle");

describe("effortSpent", () => {
  it("counts ground covered: further is more", () => {
    expect(spent(at(0), at(4))).toBeGreaterThan(spent(at(0), at(2)));
    expect(spent(at(0), at(2))).toBeGreaterThan(spent(at(0), at(0)));
  });

  it("counts time on a skill even standing still, but not on one that uses no part of the body, nor asleep", () => {
    expect(spent(at(0), at(0), 1000)).toBeCloseTo(2 * spent(at(0), at(0), 500));
    expect(spent(at(0), at(0))).toBeGreaterThan(0);
    const idle = { skill: "idle", target: null, secondsRunning: 1 };
    expect(spent(at(0, {}, idle), at(0, {}, idle))).toBe(0);
    expect(spent(at(0), at(0, { asleep: true }))).toBe(0);
  });

  it("counts food energy burned, from the bar or the reserve behind it", () => {
    const still = spent(at(0), at(0));
    expect(spent(at(0, { saturation: 5 }), at(0, { saturation: 3 }))).toBeGreaterThan(still);
    expect(spent(at(0, { food: 20, saturation: 0 }), at(0, { food: 19, saturation: 0 }))).toBeGreaterThan(still);
    // Eating fills the bar: that is not work. Nor is the food a mending body burns.
    expect(spent(at(0, { food: 10 }), at(0, { food: 16 }))).toBeCloseTo(still);
    expect(spent(at(0, { saturation: 5 }), at(0, { saturation: 3, healing: true }))).toBeCloseTo(still);
  });

  it("does not take a teleport, a respawn or a long pause for work", () => {
    const still = spent(at(0), at(0));
    expect(spent(at(0), at(50))).toBeCloseTo(still);
    expect(spent(at(0), at(3, { displaced: true }))).toBeCloseTo(still);
    expect(spent(at(0), at(3, { deaths: 1 }))).toBe(0);
    expect(spent(at(0), at(0), 30 * 60_000)).toBeCloseTo(spent(at(0), at(0), 2000));
  });

  it("is 0 for a state that is not Minecraft's", () => {
    const other = { schemaVersion: 1, tick: 0, timestamp: 0, data: {} };
    expect(effortSpent({ before: other, after: other })).toBe(0);
  });
});
