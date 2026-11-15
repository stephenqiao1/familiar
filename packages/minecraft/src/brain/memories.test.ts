import type { SkillEvent } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import type { MemoryTrigger } from "@familiar/memory";
import { describe, expect, it } from "vitest";
import { fakeState, type StatePatch } from "../encode/state.test-helper.js";
import { closeCall, died, firstSight, goalDone, notableReward, placeOf, skillFailed, tookDamage } from "./memories.js";

const zombie = { id: "entity:1", type: "zombie", dist: 3, hostile: true, reachable: true };

function check(trigger: MemoryTrigger, before: StatePatch, after: StatePatch, events: SkillEvent[] = [], store = createWorkspace()) {
  return trigger.check({ before: fakeState(before), after: fakeState(after), events, ws: store.viewFor("hippocampus") });
}

describe("player memories", () => {
  it("knows where the bot is", () => {
    expect(placeOf(fakeState())).toEqual({ x: 0, y: 63, z: 0, dimension: "overworld" });
    expect(placeOf({ schemaVersion: 0, tick: 0, timestamp: 0, data: {} })).toBeNull();
  });

  it("remembers heavy damage, with what did it and where, in one plain sentence", () => {
    const night = { time: { isNight: true }, nearby: { mobs: [zombie] } };
    expect(check(tookDamage, { ...night, self: { health: 20 } }, { ...night, self: { health: 14 } })).toEqual({
      kind: "danger",
      summary: "Took heavy damage from a zombie at night in plains",
      involved: ["zombie"],
      outcome: { feeling: "bad", value: -0.3 },
      context: ["night"],
    });
    expect(check(tookDamage, { self: { health: 20 } }, { self: { health: 18 } })).toBeNull();
  });

  it("remembers a close call, even with no damage taken", () => {
    expect(check(closeCall(), {}, { nearby: { mobs: [zombie] } })).toMatchObject({ kind: "danger", summary: "Was surprised by a zombie in plains", outcome: { feeling: "bad", value: -0.2 } });
    expect(check(closeCall(), { nearby: { mobs: [zombie] } }, { nearby: { mobs: [zombie] } })).toBeNull();
    // The same mob stepping out and back in is one encounter.
    const trigger = closeCall();
    expect(check(trigger, {}, { nearby: { mobs: [zombie] } })).not.toBeNull();
    expect(check(trigger, {}, { nearby: { mobs: [zombie] } })).toBeNull();
  });

  it("remembers dying, described by where it died", () => {
    expect(check(died, { nearby: { mobs: [zombie] } }, { self: { deaths: 1 } })).toMatchObject({ kind: "death", summary: "Died to a zombie in plains", atPlaceBefore: true });
    // A death is one memory, not also a damage memory.
    expect(check(tookDamage, { self: { health: 20 } }, { self: { health: 0, deaths: 1 } })).toBeNull();
  });

  it("remembers a notable reward", () => {
    const store = createWorkspace();
    store.viewFor("dopamine").setSignal("reward", 0.8);
    const eating = { current: { skill: "eat", target: null, secondsRunning: 1 } };
    expect(check(notableReward, {}, eating, [], store)).toMatchObject({ kind: "reward", summary: "Something went well while doing eat in plains", outcome: { feeling: "good", value: 0.8 } });
    store.viewFor("dopamine").setSignal("reward", 0.2);
    expect(check(notableReward, {}, eating, [], store)).toBeNull();
    // A reward that is all novelty is left to the first-sight memory.
    store.viewFor("dopamine").setSignal("reward", 0.8);
    store.viewFor("dopamine").setSignal("novelty", 0.8);
    expect(check(notableReward, {}, eating, [], store)).toBeNull();
  });

  it("remembers the first sight of a thing or place, once, but not items", () => {
    const cow = { id: "entity:2", type: "cow", dist: 5, hostile: false, reachable: true };
    expect(check(firstSight, {}, { nearby: { mobs: [cow] } })).toEqual({
      kind: "discovery",
      summary: "First saw a cow in plains",
      involved: ["cow"],
      outcome: { feeling: "neutral", value: 0 },
      once: true,
    });
    expect(check(firstSight, {}, { self: { biome: "desert" } })?.summary).toBe("First came to desert");
    expect(check(firstSight, {}, { self: { inventory: { bread: 1 } } })).toBeNull();
    expect(check(firstSight, { nearby: { mobs: [cow] } }, { nearby: { mobs: [cow] } })).toBeNull();
  });

  it("remembers a skill that failed, but not one that could not start", () => {
    const failed = (reason: string): SkillEvent => ({ skill: "go_to", type: "failed", reason, timestamp: 0 });
    expect(check(skillFailed, {}, {}, [failed("timeout")])).toMatchObject({ kind: "failure", summary: "Failed to go to (timeout) in plains", involved: ["go_to"] });
    expect(check(skillFailed, {}, {}, [failed("cannot run")])).toBeNull();
  });

  it("remembers finishing a goal, when its last step is judged done", () => {
    const store = createWorkspace();
    const trigger = goalDone();
    const setGoal = (stepsDone: number, stepDoneAt: number | null) => store.viewFor("prefrontal").setGoal({ text: "Build a shelter", steps: ["a", "b"], reason: "", stepsDone, stepDoneAt });
    setGoal(1, 1000);
    expect(check(trigger, {}, {}, [], store)).toBeNull();
    setGoal(2, 2000);
    expect(check(trigger, {}, {}, [], store)).toMatchObject({ kind: "goal_done", summary: "Finished a goal: Build a shelter" });
    expect(check(trigger, {}, {}, [], store)).toBeNull();
  });
});
