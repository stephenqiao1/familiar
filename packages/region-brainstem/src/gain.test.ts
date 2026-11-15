import { describe, expect, it } from "vitest";
import { createWorkspace } from "@familiar/core";
import { createReflexGain, HELD_BACK, isHeldBack, MAX_GAIN, MIN_GAIN, reflexGain } from "./gain.js";
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
    expect(isHeldBack({ holdBack: ["flee"] }, "threat_contact", "flee")).toBe(true);
    expect(isHeldBack({ holdBack: ["threat_contact"] }, "threat_contact", "attack")).toBe(true);
    expect(isHeldBack({ holdBack: ["flee"] }, "threat_contact", "attack")).toBe(false);
    expect(isHeldBack(null, "threat_contact", "flee")).toBe(false);
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
});
