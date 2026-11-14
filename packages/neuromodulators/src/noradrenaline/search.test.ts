import type { Goal } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSearch, failedPredictions, goalProgress, rewardTrend } from "./search.js";
import { DEFAULT_NORADRENALINE } from "./settings.js";
import { switchMarginFactor } from "./signals.js";

describe("createSearch", () => {
  /** Holds the same pressure for `seconds`, one update a second. */
  const hold = (search: ReturnType<typeof createSearch>, pressure: number, seconds: number, from = 0) => {
    let level = search.level();
    for (let s = 0; s <= seconds; s++) level = search.update(pressure, 0, (from + s) * 1000);
    return level;
  };

  it("rests at the bot's resting level", () => {
    expect(createSearch(DEFAULT_NORADRENALINE).level()).toBe(0.3);
    expect(hold(createSearch(DEFAULT_NORADRENALINE), 0, 600)).toBeCloseTo(0.3);
  });

  it("climbs slowly under pressure and sinks with success, within 0.05 to 0.95", () => {
    expect(hold(createSearch(DEFAULT_NORADRENALINE), 1, 90)).toBeGreaterThan(0.5);
    expect(hold(createSearch(DEFAULT_NORADRENALINE), 3, 3600)).toBe(0.95);
    expect(hold(createSearch(DEFAULT_NORADRENALINE), -1, 3600)).toBe(0.05);
  });

  it("drifts back to rest once the pressure is gone", () => {
    const search = createSearch(DEFAULT_NORADRENALINE);
    hold(search, 2, 300);
    expect(hold(search, 0, 900, 301)).toBeCloseTo(0.3, 2);
  });

  it("takes a one-off bump", () => {
    expect(createSearch(DEFAULT_NORADRENALINE).update(0, 0.05, 0)).toBeCloseTo(0.35);
  });
});

describe("switchMarginFactor", () => {
  it("makes the margin smaller at search 0.9 than at 0.1, and leaves it alone at 0.3", () => {
    expect(switchMarginFactor(0.9)).toBeLessThan(switchMarginFactor(0.1));
    expect(switchMarginFactor(0.3)).toBe(1);
  });
});

describe("search inputs", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A workspace whose signals are stamped with the fake clock. */
  function world() {
    const store = createWorkspace();
    const dopamine = store.viewFor("dopamine");
    const ws = store.viewFor("noradrenaline");
    const at = (seconds: number) => vi.setSystemTime(seconds * 1000);
    return { store, dopamine, ws, at };
  }

  it("reward trend: steady rewards pull search down; a falling rate pushes it up", () => {
    const { dopamine, ws, at } = world();
    const input = rewardTrend();
    let value = 0;
    // A reward every 10 seconds for 15 minutes, then nothing.
    for (let s = 0; s <= 900; s++) {
      at(s);
      dopamine.setSignal("reward", s % 10 === 0 ? 0.2 : 0);
      value = input.read(ws, s * 1000);
    }
    expect(value).toBeLessThan(0);
    for (let s = 901; s <= 1020; s++) {
      at(s);
      dopamine.setSignal("reward", 0);
      value = input.read(ws, s * 1000);
    }
    expect(value).toBeGreaterThan(0.5);
  });

  it("reward trend: says nothing when there has been no reward to compare with", () => {
    const { dopamine, ws, at } = world();
    at(0);
    dopamine.setSignal("reward", 0);
    expect(rewardTrend().read(ws, 0)).toBe(0);
  });

  it("failed predictions: three medium surprises in a row push up; a small or big one breaks the run", () => {
    const { dopamine, ws, at } = world();
    const input = failedPredictions();
    const feel = (seconds: number, surprise: number) => {
      at(seconds);
      dopamine.setSignal("surprise", surprise);
      return input.read(ws, seconds * 1000);
    };
    expect(feel(1, 0.4)).toBe(0);
    expect(feel(2, 0)).toBe(0); // no skill ended: the run is neither extended nor broken
    expect(feel(3, 0.5)).toBe(0);
    expect(feel(4, 0.4)).toBe(1);
    expect(feel(5, 0.9)).toBe(0); // big: alarm's business
    expect(feel(6, 0.4)).toBe(0);
    expect(feel(7, 0.1)).toBe(0); // as expected: predictions are working
  });

  it("goal progress: pulls down right after a step, pushes up after minutes with none", () => {
    const { store, ws } = world();
    const input = goalProgress();
    expect(input.read(ws, 0)).toBe(0); // no goal
    const setGoal = (stepDoneAt: Goal["stepDoneAt"]) => store.viewFor("prefrontal").setGoal({ text: "g", steps: ["a", "b"], reason: "", stepDoneAt });
    setGoal(null);
    expect(input.read(ws, 0)).toBe(0);
    expect(input.read(ws, 120_000)).toBe(0);
    expect(input.read(ws, 180_000)).toBeCloseTo(0.5);
    expect(input.read(ws, 600_000)).toBe(1);
    setGoal(600_000);
    expect(input.read(ws, 600_000)).toBe(-1);
    expect(input.read(ws, 620_000)).toBe(-1);
    expect(input.read(ws, 660_000)).toBe(0);
  });
});
