import type { Candidate, Workspace } from "@familiar/contracts";
import { describe, expect, it } from "vitest";
import { createValueWeightedArbiter } from "./value-weighted.js";

const ws = {} as Workspace;
const c = (skill: string, urgency: number, layer = 1): Candidate => ({ region: "r", layer, urgency, action: { skill }, reason: skill });
const values: Record<string, number> = { go_to: 1, idle: -0.5 };
const arbiter = createValueWeightedArbiter({ valueOf: (skill) => values[skill] ?? 0 });

describe("createValueWeightedArbiter", () => {
  it("lets a skill's value outweigh a small urgency gap, and notes it in the reason", () => {
    expect(arbiter.pick([c("idle", 0.6), c("go_to", 0.5)], ws)).toMatchObject({ action: { skill: "go_to" }, reason: "go_to; value 1.00" });
  });

  it("still follows urgency when the gap is big", () => {
    expect(arbiter.pick([c("idle", 0.8), c("go_to", 0.4)], ws)?.action).toEqual({ skill: "idle" });
  });

  it("acts like highest urgency when nothing has a value", () => {
    expect(arbiter.pick([c("eat", 0.3), c("sleep", 0.5)], ws)?.action).toEqual({ skill: "sleep" });
  });

  it("always lets a full-urgency candidate win", () => {
    expect(arbiter.pick([c("go_to", 0.9), c("flee", 1, 0)], ws)?.action).toEqual({ skill: "flee" });
  });

  it("scales a skill's score, noting it in the reason, but never a full-urgency candidate", () => {
    const braked = createValueWeightedArbiter({ valueOf: () => 0, scaleOf: (skill) => (skill === "attack" ? 0.5 : 1) });
    expect(braked.pick([c("attack", 0.8), c("idle", 0.5)], ws)).toMatchObject({ action: { skill: "idle" }, reason: "idle; value 0.00" });
    expect(braked.pick([c("attack", 0.8), c("idle", 0.3)], ws)?.reason).toBe("attack; value 0.00; scaled ×0.50");
    expect(braked.pick([c("attack", 1, 0), c("idle", 0.9)], ws)?.action).toEqual({ skill: "attack" });
  });

  it("adds a skill's bonus to its score, noting it in the reason", () => {
    const sticky = createValueWeightedArbiter({ valueOf: () => 0, bonusOf: (skill) => (skill === "go_to" ? 0.15 : 0) });
    expect(sticky.pick([c("go_to", 0.5), c("idle", 0.6)], ws)?.reason).toBe("go_to; value 0.00; bonus +0.15");
    expect(sticky.pick([c("go_to", 0.5), c("idle", 0.7)], ws)?.action).toEqual({ skill: "idle" });
    expect(sticky.pick([c("go_to", 0.5), c("flee", 1, 0)], ws)?.action).toEqual({ skill: "flee" });
  });

  it("values keep-going at 0", () => {
    const keepGoing: Candidate = { region: "r", layer: 1, urgency: 0.5, action: { keepGoing: true }, reason: "" };
    expect(arbiter.pick([keepGoing, c("idle", 0.55)], ws)?.action).toEqual({ keepGoing: true });
  });

  it("is empty-handed with no candidates", () => {
    expect(arbiter.pick([], ws)).toBeNull();
  });

  it("settles early only on a full-urgency candidate no pending layer can beat", () => {
    expect(arbiter.settledEarly!([c("flee", 1, 0)], [1, 2], ws)?.action).toEqual({ skill: "flee" });
    expect(arbiter.settledEarly!([c("go_to", 0.9, 0)], [1], ws)).toBeNull();
  });
});
