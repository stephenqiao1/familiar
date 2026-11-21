import type { SkillEvent } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { describe, expect, it } from "vitest";
import { fakeState, type StatePatch } from "../encode/state.test-helper.js";
import { equipped, fed, isShock, lightAndShelter, progress, safety } from "./outlook.js";

function workspace(patch: StatePatch = {}, events: SkillEvent["type"][] = []) {
  const store = createWorkspace();
  store.update(fakeState(patch), null);
  for (const type of events) store.addEvent({ skill: "go_to", type, timestamp: 0 });
  return store;
}
const read = (input: typeof safety, patch?: StatePatch) => input.read(workspace(patch).viewFor("serotonin"));
/** A zombie that has not noticed the bot (it is not closing). */
const zombie = (dist: number) => ({ id: "entity:1", type: "zombie", dist, hostile: true, reachable: true, closing: 0 });

describe("player outlook inputs", () => {
  it("safety falls with a close hostile and with low health", () => {
    expect(read(safety)).toBe(1);
    expect(read(safety, { nearby: { mobs: [zombie(2)] } })).toBeCloseTo(0.625);
    expect(read(safety, { self: { health: 5 } })).toBeCloseTo(0.625);
  });

  it("fed needs both a food bar and food carried", () => {
    expect(read(fed)).toBe(0.5);
    expect(read(fed, { self: { foodItems: 8 } })).toBe(1);
    expect(read(fed, { self: { food: 0 } })).toBe(0);
  });

  it("light and shelter is full by day; at night it needs light and shelter", () => {
    expect(read(lightAndShelter, { time: { lightLevel: 0 } })).toBe(1);
    expect(read(lightAndShelter, { time: { isNight: true, lightLevel: 0 } })).toBe(0);
    expect(read(lightAndShelter, { time: { isNight: true, lightLevel: 15 }, self: { enclosed: true } })).toBe(1);
    // No view of the sky is not shelter: a cave mouth or a tree overhead leaves it half way.
    expect(read(lightAndShelter, { time: { isNight: true, lightLevel: 15 }, self: { skyLight: 0 } })).toBe(0.5);
  });

  it("equipped follows what the goal wants carried, else a weapon", () => {
    expect(read(equipped)).toBe(0.5);
    expect(read(equipped, { self: { bestWeapon: "stone_sword" } })).toBe(1);
    const store = workspace({ self: { inventory: { bread: 2 } } });
    store.viewFor("prefrontal").setGoal({ text: "", steps: [], reason: "", wants: [{ item: "bread", count: 4 }, { item: "torch", count: 8 }] });
    expect(equipped.read(store.viewFor("serotonin"))).toBe(0.25);
  });

  it("progress is the share of recent skills that succeeded", () => {
    expect(progress.read(workspace().viewFor("s"))).toBe(0.5);
    expect(progress.read(workspace({}, ["started", "done", "failed", "interrupted", "done"]).viewFor("s"))).toBeCloseTo(2 / 3);
  });

  it("progress is full right after a step of the goal is finished, then fades back", () => {
    const at = (timestamp: number) => {
      const store = createWorkspace();
      store.update(fakeState({}, timestamp), null);
      store.viewFor("prefrontal").setGoal({ text: "", steps: ["a"], reason: "", stepsDone: 1, stepDoneAt: 1000 });
      return progress.read(store.viewFor("s"));
    };
    expect(at(1000)).toBe(1);
    expect(at(121_000)).toBeCloseTo(0.5 + 0.5 / Math.E);
    expect(at(3_600_000)).toBeCloseTo(0.5);
  });

  it("is unknown before the first Minecraft state", () => {
    expect(safety.read(createWorkspace().viewFor("s"))).toBeNull();
  });
});

describe("isShock", () => {
  it("is a hostile appearing close by, or heavy damage", () => {
    expect(isShock(fakeState(), fakeState({ nearby: { mobs: [zombie(5)] } }))).toBe(true);
    expect(isShock(fakeState({ nearby: { mobs: [zombie(5)] } }), fakeState({ nearby: { mobs: [zombie(3)] } }))).toBe(false);
    expect(isShock(fakeState(), fakeState({ nearby: { mobs: [zombie(20)] } }))).toBe(false);
    expect(isShock(fakeState(), fakeState({ self: { health: 14 } }))).toBe(true);
    expect(isShock(fakeState(), fakeState({ self: { health: 17 } }))).toBe(false);
  });
});
