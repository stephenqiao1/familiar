import { createWorkspace } from "@familiar/core";
import { describe, expect, it } from "vitest";
import { createSearch, gettingNowhere } from "./search.js";
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
    expect(hold(createSearch(DEFAULT_NORADRENALINE), 1, 60)).toBeGreaterThan(0.7);
    // Half the pressure heads for half way between rest and the top: within reach of what search does.
    expect(hold(createSearch(DEFAULT_NORADRENALINE), 0.5, 600)).toBeCloseTo(0.65, 2);
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

describe("gettingNowhere", () => {
  const ws = createWorkspace().viewFor("noradrenaline");
  const input = (pressing: number, progress: number) => gettingNowhere(() => pressing, () => progress).read(ws, 0);

  it("pushes search up by how hard a need presses while the bot is getting nowhere", () => {
    expect(input(1, 0)).toBe(1);
    expect(input(0.4, 0)).toBe(0.4);
  });

  it("pulls it down while the bot is getting somewhere, though the need still presses", () => {
    expect(input(1, 1)).toBe(-1);
    expect(input(1, 0.5)).toBe(0);
  });

  it("pulls it down with nothing pressing: what the bot is doing is working", () => {
    expect(input(0, 0)).toBe(-0.5);
    expect(input(0, 1)).toBe(-0.5);
  });
});
