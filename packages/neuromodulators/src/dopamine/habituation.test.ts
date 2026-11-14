import { describe, expect, it } from "vitest";
import { createHabituation } from "./habituation.js";

describe("createHabituation", () => {
  it("halves a reward each time the same source pays again soon", () => {
    const h = createHabituation();
    expect(h.dampen("threat_gone", 0.6, 0)).toEqual({ amount: 0.6, repeats: 0 });
    expect(h.dampen("threat_gone", 0.6, 0)).toEqual({ amount: 0.3, repeats: 1 });
    expect(h.dampen("threat_gone", 0.6, 0)).toEqual({ amount: 0.15, repeats: 2 });
  });

  it("counts a small reward for little, so a trickle does not wear down a real reward", () => {
    const h = createHabituation();
    for (let i = 0; i < 20; i++) h.dampen("health_up", 0.005, i * 1000);
    expect(h.dampen("health_up", 0.6, 20_000).amount).toBeGreaterThan(0.5);
  });

  it("keeps sources apart", () => {
    const h = createHabituation();
    h.dampen("threat_gone", 0.6, 0);
    expect(h.dampen("food_bar_up", 0.4, 0).amount).toBe(0.4);
  });

  it("pays nearly in full again after a quiet spell", () => {
    const h = createHabituation();
    h.dampen("threat_gone", 0.6, 0);
    h.dampen("threat_gone", 0.6, 0);
    expect(h.dampen("threat_gone", 0.6, 3_600_000).amount).toBeCloseTo(0.6);
  });

  it("never shrinks or counts a negative reward", () => {
    const h = createHabituation();
    expect(h.dampen("damage_taken", -0.5, 0)).toEqual({ amount: -0.5, repeats: 0 });
    expect(h.dampen("damage_taken", -0.5, 0)).toEqual({ amount: -0.5, repeats: 0 });
  });
});
