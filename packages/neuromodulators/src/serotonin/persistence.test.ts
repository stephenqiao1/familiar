import type { SkillEvent } from "@familiar/contracts";
import { describe, expect, it } from "vitest";
import { createPersistence, MAX_STAY_BONUS, PROGRESS_WINDOW_MS } from "./persistence.js";

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
  it("starts the clock from a skill's own base where one is known, and from the fixed base otherwise", () => {
    const persistence = createPersistence({ patience: () => 0.5, chanceOf: () => 0.5, strength: 1, baseOf: (skill) => (skill === "dig" ? 30_000 : BASE), mostBaseMs: 3 * BASE });
    persistence.observe(event("dig", "started", 0));
    expect(persistence.status(1000)).toMatchObject({ baseSeconds: 30, giveUpSeconds: 30 });
    expect(persistence.giveUpReason(29_999)).toBeNull();
    expect(persistence.giveUpReason(30_000)).toContain("gave up after 30 s");
    persistence.observe(event("dig", "failed", 30_000));
    persistence.observe(event("go_to", "started", 40_000));
    expect(persistence.giveUpReason(40_000 + BASE - 1)).toBeNull();
    expect(persistence.giveUpReason(40_000 + BASE)).not.toBeNull();
    // The backstop leaves room for the longest base there can be.
    expect(persistence.backstopMs()).toBe(9 * BASE);
  });

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

  it("protects the running skill while it is getting somewhere: the bonus fades within seconds of no progress", () => {
    const { persistence, start } = setup(0.5);
    expect(persistence.stayBonus("go_to", 0)).toBe(0);
    start("go_to");
    expect(persistence.stayBonus("go_to", 0)).toBe(MAX_STAY_BONUS);
    expect(persistence.stayBonus("go_to", PROGRESS_WINDOW_MS / 2)).toBeCloseTo(MAX_STAY_BONUS / 2);
    expect(persistence.stayBonus("go_to", PROGRESS_WINDOW_MS)).toBe(0);
    expect(persistence.stayBonus("idle", 0)).toBe(0);
    // It gets somewhere: protected in full again, and not given up on any sooner.
    persistence.progress(PROGRESS_WINDOW_MS);
    expect(persistence.stayBonus("go_to", PROGRESS_WINDOW_MS)).toBe(MAX_STAY_BONUS);
    expect(persistence.status(PROGRESS_WINDOW_MS)).toMatchObject({ progress: 1, waitedSeconds: 0 });
  });

  it("a patient bot keeps the protection longer without progress, an impatient one drops it sooner", () => {
    const at = (patience: number) => {
      const { persistence, start } = setup(patience);
      start("go_to");
      return persistence.stayBonus("go_to", PROGRESS_WINDOW_MS);
    };
    expect(at(0.9)).toBeGreaterThan(0);
    expect(at(0.5)).toBe(0);
    expect(at(0.1)).toBe(0);
  });

  it("a skill given up on may not be started again at once: 8 s the first time, longer each time in a row, until a run finishes", () => {
    const { persistence } = setup(0.5);
    /** Runs the skill from `at` until it is given up on; returns when that was. */
    const giveUp = (at: number) => {
      persistence.observe(event("go_to", "started", at));
      expect(persistence.giveUpReason(at + BASE)).toMatch(/^gave up/);
      persistence.observe(event("go_to", "failed", at + BASE));
      return at + BASE;
    };
    expect(persistence.heldBack("go_to", 0)).toBe(false);
    const first = giveUp(0);
    expect(persistence.heldBack("go_to", first + 7999)).toBe(true);
    expect(persistence.heldBack("go_to", first + 8000)).toBe(false);
    expect(persistence.heldBack("idle", first)).toBe(false);
    const second = giveUp(first + 10_000);
    expect(persistence.heldBack("go_to", second + 15_999)).toBe(true);
    expect(persistence.heldBack("go_to", second + 16_000)).toBe(false);
    // A run that finishes ends it, and the next give-up starts from 8 s again.
    persistence.observe(event("go_to", "started", second + 20_000));
    persistence.observe(event("go_to", "done", second + 21_000));
    const third = giveUp(second + 30_000);
    expect(persistence.heldBack("go_to", third + 8000)).toBe(false);
  });

  it("a skill that failed for another reason is not held back", () => {
    const { persistence, run } = setup(0.5);
    const ended = run("go_to", "failed", 0);
    expect(persistence.heldBack("go_to", ended)).toBe(false);
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
