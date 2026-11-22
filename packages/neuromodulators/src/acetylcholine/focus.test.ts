import { describe, expect, it } from "vitest";
import { createAttention, NEUTRAL_BUDGET } from "./attention.js";
import { createCuePulse } from "./cue-pulse.js";
import { createFocus, trustOf } from "./focus.js";
import { DEFAULT_FOCUS, focusProblem } from "./settings.js";

describe("createFocus", () => {
  const hold = (focus: ReturnType<typeof createFocus>, pressure: number, seconds: number, asleep = false) => {
    let level = focus.level();
    for (let s = 0; s <= seconds; s++) level = focus.update(pressure, asleep, s * 1000);
    return level;
  };

  it("rests at the bot's resting level", () => {
    expect(createFocus(DEFAULT_FOCUS).level()).toBe(0.5);
    expect(hold(createFocus(DEFAULT_FOCUS), 0, 600)).toBeCloseTo(0.5);
  });

  it("rises when conditions are unreliable or demanding, falls with routine and rest, within 0.05 to 0.95", () => {
    expect(hold(createFocus(DEFAULT_FOCUS), 2, 90)).toBeGreaterThan(0.85);
    expect(hold(createFocus(DEFAULT_FOCUS), -2, 90)).toBeLessThan(0.15);
    expect(hold(createFocus(DEFAULT_FOCUS), 4, 3600)).toBe(0.95);
    expect(hold(createFocus(DEFAULT_FOCUS), -4, 3600)).toBe(0.05);
  });

  it("is forced to 0.05 while asleep, whatever the inputs", () => {
    const focus = createFocus(DEFAULT_FOCUS);
    hold(focus, 4, 600);
    expect(focus.update(4, true, 601_000)).toBe(0.05);
  });
});

describe("trustOf", () => {
  it("halves every half-life", () => {
    expect(trustOf(0, 600_000)).toBe(1);
    expect(trustOf(600_000, 600_000)).toBe(0.5);
    expect(trustOf(1_200_000, 600_000)).toBe(0.25);
  });
});

describe("createCuePulse", () => {
  const chest = { id: "pos:1,2,3", kind: "chest" };

  it("does not fire on a single sighting", () => {
    const pulse = createCuePulse();
    expect(pulse.observe([chest])).toBeNull();
    expect(pulse.observe([])).toBeNull();
    expect(pulse.observe([chest])).toBeNull();
  });

  it("fires exactly once when seen twice in a row, and again only after it has left view", () => {
    const pulse = createCuePulse();
    expect(pulse.observe([chest])).toBeNull();
    expect(pulse.observe([chest])).toEqual(chest);
    expect(pulse.observe([chest])).toBeNull();
    expect(pulse.observe([chest])).toBeNull();
    pulse.observe([]);
    pulse.observe([chest]);
    expect(pulse.observe([chest])).toEqual(chest);
  });
});

describe("createAttention", () => {
  it("spends more on nearby detail at high focus and more on remembered items at low focus", () => {
    const attention = createAttention();
    expect(attention.budget(0.5, 0)).toEqual(NEUTRAL_BUDGET);
    expect(attention.budget(0.9, 0)).toEqual({ nearby: 14, remembered: 3 });
    expect(attention.budget(0.1, 0)).toEqual({ nearby: 6, remembered: 7 });
  });

  it("guardrail: cuts detail for a minute after hitting the limit on over half of a minute's ticks", () => {
    const attention = createAttention();
    let note: string | null = null;
    for (let s = 0; s <= 60; s++) note = attention.report(s % 3 !== 0, s * 1000) ?? note;
    expect(note).toMatch(/^swamped/);
    expect(attention.budget(0.5, 61_000).nearby).toBe(5);
    expect(attention.budget(0.5, 121_000).nearby).toBe(10);
  });

  it("does not cut detail when the limit is hit less than half the time", () => {
    const attention = createAttention();
    let note: string | null = null;
    for (let s = 0; s <= 120; s++) note = attention.report(s % 3 === 0, s * 1000) ?? note;
    expect(note).toBeNull();
  });
});

describe("focusProblem", () => {
  it("accepts the defaults and rejects values out of range", () => {
    expect(focusProblem(DEFAULT_FOCUS)).toBeNull();
    expect(focusProblem({ ...DEFAULT_FOCUS, resting: 1 })).toMatch(/resting/);
    expect(focusProblem({ ...DEFAULT_FOCUS, trustHalfLifeMinutes: 0 })).toMatch(/trustHalfLifeMinutes/);
    expect(focusProblem({ ...DEFAULT_FOCUS, cuePulse: 2 })).toMatch(/cuePulse/);
  });
});
