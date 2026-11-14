import type { SkillEvent } from "@familiar/contracts";
import { describe, expect, it } from "vitest";
import { createPersistence, MAX_STAY_BONUS } from "./persistence.js";

const BASE = 120_000;
const event = (skill: string, type: SkillEvent["type"], timestamp: number): SkillEvent => ({ skill, type, timestamp });

function setup(initialPatience: number, strength = 1) {
  const world = { patience: initialPatience, chance: 0.5 };
  const persistence = createPersistence({ patience: () => world.patience, chanceOf: () => world.chance, strength });
  /** Runs `skill` for `ms` and ends it; returns the end time. */
  const run = (skill: string, type: SkillEvent["type"], from: number, ms = 1000) => {
    persistence.observe(event(skill, "started", from));
    persistence.observe(event(skill, type, from + ms));
    return from + ms;
  };
  const start = (skill: string, at = 0) => persistence.observe(event(skill, "started", at));
  return { persistence, world, run, start };
}

describe("createPersistence", () => {
  it("gives up at the base time at neutral patience with no history", () => {
    const { persistence, start } = setup(0.5);
    start("go_to");
    expect(persistence.giveUpReason(BASE - 1)).toBeNull();
    expect(persistence.giveUpReason(BASE)).toBe("gave up after 120 s (patience 0.50, chance 0.50)");
  });

  it("waits longer with more patience, working from the patience it has now", () => {
    const { persistence, world, start } = setup(0.9);
    start("go_to");
    expect(persistence.giveUpReason(BASE)).toBeNull(); // 1.4 × the base time
    world.patience = 0.1; // things turned bad mid-skill: 0.6 × the base time, already past
    expect(persistence.giveUpReason(BASE)).toMatch(/^gave up after 120 s \(patience 0\.10/);
  });

  it("restarts the clock when the skill makes progress", () => {
    const { persistence, start } = setup(0.5);
    start("go_to");
    persistence.progress(BASE - 1000);
    expect(persistence.giveUpReason(BASE)).toBeNull();
    expect(persistence.giveUpReason(2 * BASE - 1000)).not.toBeNull();
  });

  it("protects the running skill with a bonus that fades as its time runs out", () => {
    const { persistence, start } = setup(0.5);
    expect(persistence.stayBonus("go_to", 0)).toBe(0);
    start("go_to");
    expect(persistence.stayBonus("go_to", 0)).toBe(MAX_STAY_BONUS);
    expect(persistence.stayBonus("go_to", BASE / 2)).toBeCloseTo(MAX_STAY_BONUS / 2);
    expect(persistence.stayBonus("go_to", BASE)).toBe(0);
    expect(persistence.stayBonus("idle", 0)).toBe(0);
  });

  it("waits longer for a skill with a better chance of payoff", () => {
    const { persistence, world, start } = setup(0.5);
    start("eat");
    world.chance = 0.8;
    expect(persistence.status(0)).toMatchObject({ chanceOfPayoff: 0.8, giveUpSeconds: 120 * 1.3 });
    world.chance = 0.2;
    expect(persistence.status(0)?.giveUpSeconds).toBeCloseTo(120 * 0.7);
  });

  it("guardrail: ignores patience once a skill has gone over 3× its base time without success", () => {
    const { persistence, run, start } = setup(0.95);
    let t = 0;
    for (let i = 0; i < 2; i++) t = run("go_to", "interrupted", t, 1.4 * BASE);
    start("go_to", t);
    expect(persistence.status(t + 0.1 * BASE)).toMatchObject({ overPersisting: false, patience: 0.95 });
    expect(persistence.status(t + 0.3 * BASE)).toMatchObject({ overPersisting: true, patience: 0.5, giveUpSeconds: 120 });
    // A success clears it.
    persistence.observe(event("go_to", "done", t + 0.3 * BASE));
    start("go_to", t + 0.3 * BASE);
    expect(persistence.status(t + BASE)).toMatchObject({ overPersisting: false, patience: 0.95 });
  });

  it("when off: no bonus, no giving up, and the backstop is the plain base time", () => {
    const { persistence, start } = setup(0.95, 0);
    start("go_to");
    expect(persistence.stayBonus("go_to", 0)).toBe(0);
    expect(persistence.giveUpReason(10 * BASE)).toBeNull();
    expect(persistence.backstopMs()).toBe(BASE);
    expect(setup(0.5).persistence.backstopMs()).toBe(3 * BASE);
  });
});
