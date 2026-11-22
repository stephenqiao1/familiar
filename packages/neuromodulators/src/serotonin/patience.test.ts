import { describe, expect, it } from "vitest";
import { createPatience, FALL_SECONDS, outlookFrom } from "./patience.js";
import { DEFAULT_PATIENCE } from "./settings.js";

/** Feeds the same outlook once a second for `seconds`; returns the final patience. */
function hold(patience: ReturnType<typeof createPatience>, outlook: number | null, seconds: number, from = 0): number {
  let level = patience.level();
  for (let s = 0; s <= seconds; s++) level = patience.update(outlook, (from + s) * 1000);
  return level;
}

describe("createPatience", () => {
  it("starts at the resting level", () => {
    expect(createPatience(DEFAULT_PATIENCE).level()).toBe(0.5);
    expect(createPatience({ ...DEFAULT_PATIENCE, resting: 0.8 }).level()).toBe(0.8);
  });

  it("rises toward about 0.9 after two good minutes, and falls toward about 0.1 after two bad ones", () => {
    expect(hold(createPatience(DEFAULT_PATIENCE), 1, 120)).toBeGreaterThan(0.88);
    expect(hold(createPatience(DEFAULT_PATIENCE), 0, 120)).toBeLessThan(0.12);
  });

  it("never leaves 0.05 to 0.95", () => {
    expect(hold(createPatience(DEFAULT_PATIENCE), 1, 3600)).toBe(0.95);
    expect(hold(createPatience(DEFAULT_PATIENCE), 0, 3600)).toBe(0.05);
  });

  it("falls to a worse outlook within seconds, and climbs back to a better one slowly", () => {
    const patience = createPatience(DEFAULT_PATIENCE);
    const calm = hold(patience, 0.9, 300);
    // The outlook turns bad: most of the way down in a few seconds.
    const shaken = hold(patience, 0.2, FALL_SECONDS, 301);
    expect(calm - shaken).toBeGreaterThan(0.5);
    // It turns good again: after the same few seconds patience has hardly moved (but for the nudge).
    const soon = hold(patience, 0.9, FALL_SECONDS, 301 + FALL_SECONDS + 1);
    expect(soon - shaken).toBeLessThan(0.15);
    expect(hold(patience, 0.9, 180, 320)).toBeGreaterThan(0.8);
  });

  it("is nudged up while the outlook rises and down while it falls, by at most 0.1", () => {
    const steady = createPatience(DEFAULT_PATIENCE);
    steady.update(0.5, 0);
    const rising = createPatience(DEFAULT_PATIENCE);
    rising.update(0.2, 0);
    // One second on, both have barely moved, but one saw the outlook jump.
    expect(rising.update(0.9, 1000) - steady.update(0.5, 1000)).toBeGreaterThan(0.09);
    const falling = createPatience(DEFAULT_PATIENCE);
    falling.update(0.9, 0);
    expect(falling.update(0.2, 1000)).toBeLessThan(0.41);
  });

  it("drifts back to the resting level with no input", () => {
    const patience = createPatience(DEFAULT_PATIENCE);
    hold(patience, 1, 120);
    expect(hold(patience, null, 600, 121)).toBeCloseTo(0.5, 2);
  });

  it("follows the time constant: slower settings move less", () => {
    const slow = hold(createPatience({ resting: 0.5, timeConstantSeconds: 600 }), 1, 60);
    expect(slow).toBeLessThan(hold(createPatience(DEFAULT_PATIENCE), 1, 60));
  });
});

describe("outlookFrom", () => {
  const need = (level: number, weight = 1) => ({ level, weight });
  it("is 1 with every need met, and there is none with no needs known", () => {
    expect(outlookFrom([need(0), need(0)])).toBe(1);
    expect(outlookFrom([])).toBeNull();
  });

  it("one need at its worst halves it, however many others are fine: nothing is watered down", () => {
    expect(outlookFrom([need(1)])).toBe(0.5);
    expect(outlookFrom([need(1), need(0), need(0), need(0), need(0)])).toBe(0.5);
  });

  it("each further trouble lowers it, and a mild one hardly counts", () => {
    expect(outlookFrom([need(1), need(1)])).toBeCloseTo(1 / 3);
    expect(outlookFrom([need(0.25)])).toBeGreaterThan(0.94);
  });

  it("goes by each need's weight: a threat to life counts for more, being short of provisions for little", () => {
    expect(outlookFrom([need(0.5, 2)])).toBe(0.5);
    expect(outlookFrom([need(1, 0.25), need(1, 0.25), need(1, 0.25)])).toBeGreaterThan(0.8);
  });
});

