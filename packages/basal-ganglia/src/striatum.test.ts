import type { Candidate, SkillEvent, State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { describe, expect, it } from "vitest";
import { createHabits, createStriatum, HABIT, HABIT_SIGNAL, parseHabits, STILL_GOING_MS, SUPERVISE_MS, type StriatumOptions } from "./index.js";

const cand = (skill: string, urgency: number, region = "instinct", layer = 1, target?: string): Candidate => ({ region, layer, urgency, action: { skill, ...(target ? { target } : {}) }, reason: skill });

/** A striatum on a workspace: `turn` runs the region, then tells it who won (the decider's answer, unless the habit paused it). */
function bot(options: Partial<StriatumOptions> = {}) {
  const store = createWorkspace();
  const habits = options.habits ?? createHabits();
  const notes: string[] = [];
  let [situation, drive, notable, bad]: [string, string | null, string | null, boolean] = ["home", "hunger", null, false];
  const striatum = createStriatum({ habits, strength: 1, situationOf: () => situation, topDrive: () => drive, notable: () => notable, badSurprise: () => bad, risky: (s) => s === "attack", onNote: (line) => notes.push(line), ...options });
  let ms = 0;
  let running: string | null = null;
  const event = (skill: string, type: SkillEvent["type"]) => store.addEvent({ skill, type, timestamp: ms + 1 });
  /** One tick: Jev (when asked) answers `jev`; whoever is most urgent wins. */
  function turn(jev: string | null, afterMs = 500) {
    ms += afterMs;
    store.update({ schemaVersion: 0, tick: 0, timestamp: ms, data: {} } as State, running ? { skill: running, target: undefined, startedAt: 0 } : null);
    const out = striatum.region.run(store.viewFor("striatum"), new AbortController().signal) as { proposals: { action: { skill: string; target?: string }; urgency: number }[]; trace?: Record<string, unknown> };
    const paused = (store.signals()[HABIT_SIGNAL]?.value ?? 0) > 0;
    const candidates = [...out.proposals.map((p) => ({ ...p, region: "striatum", layer: 0, reason: "habit" }) as Candidate), ...(jev && !paused ? [cand(jev, 0.7)] : [])];
    const winner = candidates.reduce<Candidate | null>((best, c) => (!best || c.urgency > best.urgency ? c : best), null);
    striatum.observe({ candidates, winner, alongside: [], conflicts: [] }, store.viewFor("arbiter"));
    running = winner && "skill" in winner.action ? winner.action.skill : running;
    return { proposals: out.proposals, paused, trace: out.trace };
  }
  /** Jev chooses the skill, it runs and ends: one win. */
  const win = (skill: string, how: SkillEvent["type"] = "done") => {
    turn(skill);
    event(skill, how);
    running = null;
  };
  return { striatum, habits, notes, turn, win, event, set: (to: { situation?: string; drive?: string | null; notable?: string | null; bad?: boolean }) => ([situation, drive, notable, bad] = [to.situation ?? situation, to.drive === undefined ? drive : to.drive, to.notable === undefined ? notable : to.notable, to.bad ?? bad]), now: () => ms, strength: (skill = "eat") => habits.get(situation, skill, ms)?.strength ?? 0 };
}

/** Enough wins for a strong habit. */
const practised = (b: ReturnType<typeof bot>, skill = "eat", wins = 12) => {
  for (let i = 0; i < wins; i++) b.win(skill);
  b.turn(null);
};

describe("habits", () => {
  it("grow a little with each win that ends well, and fade slowly while unused", () => {
    const habits = createHabits();
    habits.won("home", "eat", { urgency: 0.7, drive: "hunger" }, 0);
    expect(habits.get("home", "eat", 0)?.strength).toBeCloseTo(HABIT.grow);
    habits.won("home", "eat", { urgency: 0.5, drive: "hunger" }, 0);
    expect(habits.get("home", "eat", 0)).toMatchObject({ strength: HABIT.grow + HABIT.grow * (1 - HABIT.grow), wins: 2, urgency: 0.6 });
    expect(habits.get("home", "eat", HABIT.halfLifeMs)!.strength).toBeCloseTo(habits.get("home", "eat", 0)!.strength / 2);
    expect(habits.get("away", "eat", 0)).toBeNull();
  });

  it("a saved file is read back, and broken entries are left out", () => {
    const habits = createHabits();
    habits.won("home", "eat", { urgency: 0.7, drive: null, aim: "kind:cow" }, 5);
    expect(parseHabits(JSON.parse(JSON.stringify(habits.entries())))).toEqual(habits.entries());
    expect(parseHabits({ home: { eat: { strength: 2 }, idle: { strength: 0.5, urgency: 0.3, drive: null, usedAt: 1, wins: 2 } }, x: 3 })).toEqual({ home: { idle: { strength: 0.5, urgency: 0.3, drive: null, usedAt: 1, wins: 2 } } });
  });
});

describe("the striatum", () => {
  it("a well-worn choice becomes a habit: it proposes the action itself and the decider is no longer asked", () => {
    const b = bot();
    for (let i = 0; i < 9; i++) b.win("eat");
    expect(b.strength()).toBeLessThan(HABIT.strong);
    expect(b.turn("eat")).toMatchObject({ proposals: [], paused: false });
    b.event("eat", "done");
    b.win("eat");
    b.win("eat");
    expect(b.strength()).toBeGreaterThan(HABIT.strong);
    // The first tick the decider is asked (supervision is due); then it is paused.
    b.turn("eat");
    const out = b.turn("eat");
    expect(out).toMatchObject({ paused: true, proposals: [{ action: { skill: "eat" }, urgency: 0.7 }], trace: { use: true, habit: { skill: "eat" } } });
    expect(b.notes.some((n) => n.startsWith("habit eat taken up"))).toBe(true);
  });

  it("a choice that keeps going with nothing going wrong becomes a habit too, though it never ends", () => {
    const b = bot();
    // Jev chooses to idle every half second for a minute and a half; idling never finishes.
    for (let i = 0; i < 180; i++) b.turn("idle");
    expect(b.strength("idle")).toBeGreaterThan(HABIT.strong);
    expect(b.striatum.counts().saved).toBeGreaterThan(20);
    expect(STILL_GOING_MS).toBe(5000);
  });

  it("a habit belongs to the drive it was last won in, not the one its run began in", () => {
    const b = bot();
    b.set({ drive: "health" });
    b.turn("idle");
    b.set({ drive: "tools" });
    for (let i = 0; i < 180; i++) b.turn("idle");
    expect(b.habits.get("home", "idle", b.now())).toMatchObject({ drive: "tools" });
    expect(b.turn("idle").paused || b.turn("idle").paused).toBe(true);
  });

  it("still asks the decider every five seconds, and a different answer lowers the habit", () => {
    const b = bot();
    practised(b);
    b.turn("eat");
    const before = b.strength();
    const paused = Array.from({ length: 12 }, () => b.turn("idle").paused);
    // Asked once in those six seconds, and Jev wanted something else.
    expect(paused.filter((p) => !p).length).toBeGreaterThanOrEqual(1);
    expect(b.striatum.counts()).toMatchObject({ wrong: 1 });
    expect(b.strength()).toBeLessThan(before * 0.75);
    expect(b.notes.some((n) => n.includes("the decider wanted idle"))).toBe(true);
    expect(b.striatum.counts().saved).toBeGreaterThan(5);
    expect(SUPERVISE_MS).toBe(5000);
  });

  it("is broken by anything notable, and says why", () => {
    for (const [change, why] of [[{ notable: "a threat is in view" }, "a threat is in view"], [{ drive: "rest" }, "the body wants rest now, not hunger"], [{ situation: "cave" }, "no strong habit in this situation"]] as const) {
      const b = bot();
      practised(b);
      b.turn("eat");
      expect(b.turn("eat").paused).toBe(true);
      b.set(change);
      expect(b.turn("eat")).toMatchObject({ proposals: [], paused: false });
      expect(b.notes.at(-1)).toBe(`habit eat broken: ${why}`);
      expect(b.striatum.counts().broken).toBe(1);
    }
  });

  it("blind to the drive at 1: a change in what the body wants does not break it", () => {
    const b = bot({ blind: 1 });
    practised(b);
    b.turn("eat");
    b.set({ drive: "rest" });
    expect(b.turn("eat").paused).toBe(true);
  });

  it("falls sharply when the skill fails or a bad surprise comes while it runs", () => {
    const failed = bot();
    practised(failed);
    const before = failed.strength();
    failed.win("eat", "failed");
    failed.turn(null);
    expect(failed.strength()).toBeCloseTo(before * HABIT.fall, 2);
    const surprised = bot();
    practised(surprised);
    surprised.turn("eat");
    surprised.set({ bad: true });
    surprised.turn("eat");
    expect(surprised.strength()).toBeCloseTo(before * HABIT.fall, 2);
    surprised.set({ bad: false });
    // The run that went badly is not a win when it ends.
    surprised.event("eat", "done");
    surprised.turn(null);
    expect(surprised.strength()).toBeCloseTo(before * HABIT.fall, 2);
  });

  it("a risky skill is never a habit, and a reflex's win is not one in the making", () => {
    const b = bot();
    for (let i = 0; i < 14; i++) b.win("attack");
    expect(b.strength("attack")).toBeGreaterThan(HABIT.strong);
    expect(b.turn("attack")).toMatchObject({ proposals: [], paused: false });
    const reflex = bot();
    reflex.striatum.observe({ candidates: [cand("flee", 0.9, "reflex", 0)], winner: cand("flee", 0.9, "reflex", 0), alongside: [], conflicts: [] }, createWorkspace().viewFor("arbiter"));
    reflex.event("flee", "done");
    reflex.turn(null);
    expect(reflex.strength("flee")).toBe(0);
  });

  it("aims the habit at whatever of the kind is there now, and stands down with nothing to aim at", () => {
    let cow: string | null = "cow:1";
    const b = bot({ aimOf: () => "kind:cow", targetFor: () => cow });
    const store = createWorkspace();
    for (let i = 0; i < 12; i++) {
      b.striatum.observe({ candidates: [], winner: cand("go_to", 0.7, "instinct", 1, "cow:1"), alongside: [], conflicts: [] }, store.viewFor("arbiter"));
      b.event("go_to", "done");
      b.turn(null);
    }
    cow = "cow:9";
    b.turn(null);
    expect(b.turn(null).proposals).toMatchObject([{ action: { skill: "go_to", target: "cow:9" } }]);
    cow = null;
    expect(b.turn(null).proposals).toEqual([]);
    expect(b.notes.at(-1)).toBe("habit go_to broken: nothing to aim it at");
  });

  it("at strength 0 learns nothing, proposes nothing and writes no signal", () => {
    const b = bot({ strength: 0 });
    for (let i = 0; i < 14; i++) b.win("eat");
    expect(b.strength()).toBe(0);
    expect(b.turn("eat")).toMatchObject({ proposals: [], paused: false });
  });
});
