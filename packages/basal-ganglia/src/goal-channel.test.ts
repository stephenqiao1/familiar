import { describe, expect, it } from "vitest";
import type { GoalOffer, Workspace } from "@familiar/contracts";
import { createWorkspace, goalFrom } from "@familiar/core";
import { createGoalChannel, PROTECTED_MOST_MS } from "./goal-channel.js";

const ws = {} as Workspace;
const goal = (by: string, more: Partial<GoalOffer> = {}, setAt = Date.now()) => goalFrom({ text: `${by}'s goal`, steps: [], reason: "", ...more }, by, setAt);
/** A channel in which a goal is done exactly when its "done when" says "yes". */
const channel = (strength = 1) => createGoalChannel({ strength, done: (g) => (g.doneWhen === null ? null : g.doneWhen === "yes") });

describe("the goal channel", () => {
  it("a protected goal survives an ordinary plan, and yields when its condition is true", () => {
    const plan = goal("prefrontal");
    expect(channel()(plan, goal("noradrenaline", { protected: true, doneWhen: "no", priority: 1 }), ws)).toMatch(/protected until: no/);
    expect(channel()(plan, goal("noradrenaline", { protected: true, doneWhen: "yes", priority: 1 }), ws)).toBeNull();
  });

  it("a protected goal is kept from its own setter and from another protected goal too", () => {
    const standing = goal("noradrenaline", { protected: true, doneWhen: "no" });
    expect(channel()(goal("noradrenaline"), standing, ws)).not.toBeNull();
    expect(channel()(goal("other", { protected: true, doneWhen: "no", priority: 1 }), standing, ws)).not.toBeNull();
  });

  it("a goal nobody can tell is finished cannot be protected, and none is kept longer than the limit", () => {
    expect(channel()(goal("prefrontal", { priority: 1 }), goal("noradrenaline", { protected: true }), ws)).toBeNull();
    const old = goal("noradrenaline", { protected: true, doneWhen: "no", priority: 0.5 }, Date.now() - PROTECTED_MOST_MS - 1);
    expect(channel()(goal("prefrontal"), old, ws)).toBeNull();
  });

  it("a region may always revise its own goal, and a finished goal gives way to anything", () => {
    expect(channel()(goal("prefrontal", { priority: 0.1 }), goal("prefrontal", { priority: 0.9 }), ws)).toBeNull();
    expect(channel()(goal("other", { priority: 0.1 }), goal("prefrontal", { priority: 0.9, steps: ["a"], stepsDone: 1 }), ws)).toBeNull();
    expect(channel()(goal("other", { priority: 0.1 }), goal("prefrontal", { priority: 0.9, doneWhen: "yes" }), ws)).toBeNull();
  });

  it("otherwise the offered goal must match the standing one's priority", () => {
    expect(channel()(goal("other", { priority: 0.4 }), goal("prefrontal", { priority: 0.5 }), ws)).toMatch(/priority \(0.4\) is below/);
    expect(channel()(goal("other", { priority: 0.5 }), goal("prefrontal", { priority: 0.5 }), ws)).toBeNull();
    // At half strength a rival may be up to half a point short.
    expect(channel(0.5)(goal("other", { priority: 0.4 }), goal("prefrontal", { priority: 0.8 }), ws)).toBeNull();
    expect(channel(0.5)(goal("other", { priority: 0.2 }), goal("prefrontal", { priority: 0.8 }), ws)).not.toBeNull();
  });

  it("at strength 0 every goal offered replaces the last, protected or not", () => {
    expect(channel(0)(goal("prefrontal", { priority: 0 }), goal("noradrenaline", { protected: true, doneWhen: "no", priority: 1 }), ws)).toBeNull();
  });

  it("in the workspace: a refused offer changes nothing and says why", () => {
    const store = createWorkspace({ goalGate: channel() });
    expect(store.viewFor("noradrenaline").setGoal({ text: "Retreat.", steps: [], reason: "", protected: true, doneWhen: "no", priority: 1 })).toBeUndefined();
    expect(store.viewFor("prefrontal").setGoal({ text: "Mine.", steps: [], reason: "" })).toMatch(/protected/);
    expect(store.goal()).toMatchObject({ text: "Retreat.", setBy: "noradrenaline", protected: true });
  });
});
