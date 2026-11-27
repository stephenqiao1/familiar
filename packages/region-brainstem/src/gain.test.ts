import { describe, expect, it } from "vitest";
import { createWorkspace } from "@familiar/core";
import { createReflexGain, HELD_BACK, heldBack, isHeldBack, lapsed, MAX_GAIN, MIN_GAIN, reflexGain } from "./gain.js";
import { brainstemProblem, DEFAULT_BRAINSTEM } from "./settings.js";

const calm = { alarm: 0, bravery: 0.5, leaning: null, heldBack: false } as const;

describe("reflexGain", () => {
  it("is 0.6 when calm and rises with alarm to 1.4", () => {
    expect(reflexGain(calm)).toBeCloseTo(0.6);
    expect(reflexGain({ ...calm, alarm: 0.5 })).toBeCloseTo(1.0);
    expect(reflexGain({ ...calm, alarm: 1 })).toBeCloseTo(1.4);
  });

  it("a brave bot flees less readily and fights more readily; a timid one the reverse", () => {
    const at = (bravery: number, leaning: "away" | "toward") => reflexGain({ alarm: 0.5, bravery, leaning, heldBack: false });
    expect(at(0.8, "away")).toBeLessThan(at(0.5, "away"));
    expect(at(0.2, "away")).toBeGreaterThan(at(0.5, "away"));
    expect(at(0.8, "toward")).toBeGreaterThan(at(0.5, "toward"));
    expect(at(0.2, "toward")).toBeLessThan(at(0.5, "toward"));
    // Middling bravery changes nothing, and bravery does not touch a reflex that goes neither way.
    expect(at(0.5, "away")).toBeCloseTo(1);
    expect(reflexGain({ ...calm, alarm: 0.5, bravery: 1 })).toBeCloseTo(1);
  });

  it("drops to 0.3 of itself when the goal holds the reflex back", () => {
    const free = reflexGain({ ...calm, alarm: 1 });
    expect(reflexGain({ ...calm, alarm: 1, heldBack: true })).toBeCloseTo(free * HELD_BACK);
  });

  it("stays within 0.3 to 1.5 whatever it is given", () => {
    expect(reflexGain({ alarm: 0, bravery: 1, leaning: "away", heldBack: true })).toBe(MIN_GAIN);
    expect(reflexGain({ alarm: 5, bravery: 1, leaning: "toward", heldBack: false })).toBe(MAX_GAIN);
  });

  it("with both strengths at 0 the gain is always 1", () => {
    for (const alarm of [0, 0.5, 1]) {
      expect(reflexGain({ alarm, bravery: 0.9, leaning: "away", heldBack: true }, { gains: 0, holdBack: 0 })).toBe(1);
    }
  });
});

describe("isHeldBack", () => {
  it("matches the reflex's name or the skill it proposes", () => {
    const holding = (name: string) => ({ holdBack: [{ name, strength: 1 }], stepsDone: 0 });
    expect(isHeldBack(holding("flee"), "defence_flee", "flee")).toBe(true);
    expect(isHeldBack(holding("defence_fight"), "defence_fight", "attack")).toBe(true);
    expect(isHeldBack(holding("flee"), "defence_fight", "attack")).toBe(false);
    expect(isHeldBack(null, "defence_flee", "flee")).toBe(false);
  });
});

describe("a hold-back with a strength and an end", () => {
  const goal = (held: { strength: number; until?: "step" | number }, stepsDone = 0) => ({ holdBack: [{ name: "flee", step: 0, since: 1000, ...held }], stepsDone });

  it("damps by its strength: half strength is half way between free and held back in full", () => {
    const free = reflexGain({ ...calm, alarm: 1 });
    const full = reflexGain({ ...calm, alarm: 1, heldBack: 1 });
    expect(full).toBeCloseTo(free * HELD_BACK);
    expect(reflexGain({ ...calm, alarm: 1, heldBack: 0.5 })).toBeCloseTo((free + full) / 2);
    expect(reflexGain({ ...calm, alarm: 1, heldBack: 0 })).toBeCloseTo(free);
    expect(heldBack(goal({ strength: 0.5 }), "defence_flee", "flee", 2000)).toBe(0.5);
  });

  it("ends when its step is finished", () => {
    expect(heldBack(goal({ strength: 1, until: "step" }, 0), "defence_flee", "flee", 2000)).toBe(1);
    expect(heldBack(goal({ strength: 1, until: "step" }, 1), "defence_flee", "flee", 2000)).toBe(0);
    expect(lapsed({ name: "flee", strength: 1, until: "step", step: 2 }, { stepsDone: 2 }, 0)).toBe(false);
    expect(lapsed({ name: "flee", strength: 1, until: "step", step: 2 }, { stepsDone: 3 }, 0)).toBe(true);
  });

  it("ends when its seconds are up, and one with no end lasts as long as the goal", () => {
    expect(heldBack(goal({ strength: 1, until: 5 }), "defence_flee", "flee", 5999)).toBe(1);
    expect(heldBack(goal({ strength: 1, until: 5 }), "defence_flee", "flee", 6000)).toBe(0);
    expect(heldBack(goal({ strength: 1 }, 9), "defence_flee", "flee", 1e12)).toBe(1);
  });

  it("with grading off, every hold-back is in full for as long as the goal", () => {
    expect(heldBack(goal({ strength: 0.2, until: 5 }, 3), "defence_flee", "flee", 1e12, 0)).toBe(1);
    expect(heldBack(goal({ strength: 0.2, until: "step" }, 3), "defence_flee", "flee", 1e12, 0.5)).toBe(0);
    expect(heldBack(goal({ strength: 0.2 }), "defence_flee", "flee", 0, 0.5)).toBeCloseTo(0.6);
  });

  it("the reflex region's gain reads the strength from the goal", () => {
    const gainOf = createReflexGain({ settings: { bravery: 0.5, gains: 0, holdBack: 1 }, alarmOf: () => 0.5, leaningOf: () => null });
    const ws = (strength: number) => ({ goal: { holdBack: [{ name: "flee", strength }], stepsDone: 0 } }) as never;
    const flee = { action: { skill: "flee" }, urgency: 1, reason: "" };
    expect(gainOf({ name: "defence_flee" }, ws(1), flee)).toBeCloseTo(HELD_BACK);
    expect(gainOf({ name: "defence_flee" }, ws(0.5), flee)).toBeCloseTo((1 + HELD_BACK) / 2);
  });
});

describe("createReflexGain", () => {
  it("reads alarm and the goal's hold-backs from the workspace", () => {
    const store = createWorkspace();
    const ws = store.viewFor("reflex");
    const gainOf = createReflexGain({ settings: DEFAULT_BRAINSTEM, alarmOf: (w) => w.signals.alarm?.value ?? 0, leaningOf: (skill) => (skill === "flee" ? "away" : null) });
    const flee = { action: { skill: "flee" }, urgency: 0.7, reason: "" };
    expect(gainOf({ name: "defend" }, ws, flee)).toBeCloseTo(0.6);
    ws.setSignal("alarm", 1);
    expect(gainOf({ name: "defend" }, ws, flee)).toBeCloseTo(1.4);
    ws.setGoal({ text: "stand and fight", steps: [], reason: "", holdBack: ["flee"] });
    expect(gainOf({ name: "defend" }, ws, flee)).toBeCloseTo(1.4 * HELD_BACK);
    // The hold-back ends with the goal.
    ws.setGoal({ text: "go home", steps: [], reason: "" });
    expect(gainOf({ name: "defend" }, ws, flee)).toBeCloseTo(1.4);
  });
});

describe("brainstemProblem", () => {
  it("accepts the defaults and rejects anything outside 0 to 1", () => {
    expect(brainstemProblem(DEFAULT_BRAINSTEM)).toBeNull();
    expect(brainstemProblem({ ...DEFAULT_BRAINSTEM, bravery: 1.5 })).toMatch(/brainstem.bravery/);
    expect(brainstemProblem({ ...DEFAULT_BRAINSTEM, startle: -1 })).toMatch(/brainstem.startle/);
  });

  it("a new threat's first tick is not damped: the gain uses this tick's threat when it is above last tick's alarm", () => {
    const ws = createWorkspace().viewFor("reflex");
    let threat = 0.8;
    const gainOf = createReflexGain({ settings: DEFAULT_BRAINSTEM, alarmOf: (w) => w.signals.alarm?.value ?? 0, leaningOf: () => null, threatOf: () => threat });
    const flee = { action: { skill: "flee" }, urgency: 0.7, reason: "" };
    // Alarm is still 0 (it is set later in the tick), but the threat is coming: 0.6 + 0.8 × 0.8.
    expect(gainOf({ name: "defence_flee" }, ws, flee)).toBeCloseTo(1.24);
    expect(0.7 * gainOf({ name: "defence_flee" }, ws, flee)).toBeGreaterThan(0.7);
    // Once alarm is the higher of the two, alarm sets it.
    ws.setSignal("alarm", 1);
    expect(gainOf({ name: "defence_flee" }, ws, flee)).toBeCloseTo(1.4);
    threat = 0;
    ws.setSignal("alarm", 0);
    expect(gainOf({ name: "defence_flee" }, ws, flee)).toBeCloseTo(0.6);
  });
});
