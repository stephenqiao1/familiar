import { describe, expect, it } from "vitest";
import type { Skill, State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { SCHEMA_VERSION } from "../encode/encode-state.js";
import type { MinecraftStateData } from "../encode/state-data.js";
import { fakeData } from "../encode/state.test-helper.js";
import { createChestMemory } from "../chest-memory.js";
import { describeSituation } from "./situation.js";
import { eatWhenStarving, fightOrFlight } from "./reflexes.js";
import { withGoal } from "./instinct.js";

/** A bot 12 blocks from base carrying a sword and bread. */
function data(over: { self?: Partial<MinecraftStateData["self"]>; mobs?: MinecraftStateData["nearby"]["mobs"] } = {}): MinecraftStateData {
  const self = { heldItem: "stone_sword", bestWeapon: "stone_sword", inventoryFullPct: 10, foodItems: 2, inventory: { stone_sword: 1, bread: 2 }, distanceToBase: 12 };
  return fakeData({ self: { ...self, ...over.self }, nearby: { mobs: over.mobs ?? [] } });
}

function workspace(d: MinecraftStateData) {
  const store = createWorkspace();
  const state: State = { schemaVersion: SCHEMA_VERSION, tick: 0, timestamp: 0, data: { ...d } };
  store.update(state, null);
  return store;
}

const zombie = { id: "entity:7", type: "zombie", dist: 4, hostile: true };

describe("fightOrFlight", () => {
  it("attacks a close hostile when healthy and armed", () => {
    const p = fightOrFlight.check(workspace(data({ mobs: [zombie] })).viewFor("reflex"));
    expect(p).toMatchObject({ action: { skill: "attack", target: "entity:7" }, urgency: 1 });
  });

  it("flees when hurt or unarmed", () => {
    expect(fightOrFlight.check(workspace(data({ self: { health: 6 }, mobs: [zombie] })).viewFor("r"))?.action).toEqual({ skill: "flee", target: "entity:7" });
    expect(fightOrFlight.check(workspace(data({ self: { bestWeapon: null }, mobs: [zombie] })).viewFor("r"))?.action).toEqual({ skill: "flee", target: "entity:7" });
  });

  it("ignores far or friendly mobs, and states before the first Minecraft one", () => {
    expect(fightOrFlight.check(workspace(data({ mobs: [{ ...zombie, dist: 12 }] })).viewFor("r"))).toBeNull();
    expect(fightOrFlight.check(workspace(data({ mobs: [{ ...zombie, hostile: false }] })).viewFor("r"))).toBeNull();
    expect(fightOrFlight.check(createWorkspace().viewFor("r"))).toBeNull();
  });
});

describe("eatWhenStarving", () => {
  it("eats when starving and carrying food", () => {
    expect(eatWhenStarving.check(workspace(data({ self: { food: 5 } })).viewFor("r"))).toMatchObject({ action: { skill: "eat" }, urgency: 0.9 });
  });

  it("does nothing when fed or without food", () => {
    expect(eatWhenStarving.check(workspace(data()).viewFor("r"))).toBeNull();
    expect(eatWhenStarving.check(workspace(data({ self: { food: 3, foodItems: 0 } })).viewFor("r"))).toBeNull();
  });
});

describe("withGoal", () => {
  it("adds the goal and steps to the context", () => {
    const store = workspace(data());
    expect(withGoal("ctx", store.viewFor("i"))).toBe("ctx");
    store.viewFor("prefrontal").setGoal({ text: "build a shelter", steps: ["gather wood", "build walls"], reason: "" });
    expect(withGoal("ctx", store.viewFor("i"))).toBe("ctx\nCurrent goal: build a shelter Steps: gather wood; build walls.");
  });

  it("marks the planner's goal less important as its weight falls, and drops it while the planner is offline", () => {
    const store = workspace(data());
    store.viewFor("prefrontal").setGoal({ text: "build", steps: [], reason: "" });
    const alarm = store.viewFor("noradrenaline");
    alarm.setSignal("planner_weight", 0.5);
    expect(withGoal("ctx", store.viewFor("i"))).toBe("ctx\nCurrent goal (less important right now than staying safe): build");
    alarm.setSignal("planner_offline", 1);
    expect(withGoal("ctx", store.viewFor("i"))).toBe("ctx");
    // A retreat goal set by the alarm system itself always counts.
    alarm.setGoal({ text: "retreat", steps: [], reason: "" });
    expect(withGoal("ctx", store.viewFor("i"))).toBe("ctx\nCurrent goal: retreat");
  });
});

describe("describeSituation", () => {
  it("describes the bot, its surroundings, recent events and abilities", () => {
    const store = workspace(data({ mobs: [zombie] }));
    store.addEvent({ skill: "eat", type: "failed", reason: "no food", timestamp: 0 });
    const skill = { name: "flee", description: "Run away." } as Skill<unknown>;
    const text = describeSituation(store.viewFor("prefrontal"), [skill]);
    expect(text).toContain("Health 20/20, food 20/20 (2 food items).");
    expect(text).toContain("Mobs nearby: hostile zombie at 4.");
    expect(text).toContain("Recent: eat failed (no food).");
    expect(text).toContain("- flee: Run away.");
    expect(text).toContain("Carrying: 1 stone_sword, 2 bread.");
  });

  it("describes what the remembered chests held, base chest first", () => {
    const chests = createChestMemory();
    chests.remember("pos:9,9,9", { torch: 16 }, 20);
    chests.remember("pos:1,2,3", { bread: 8 }, 10);
    const text = describeSituation(workspace(data()).viewFor("prefrontal"), [], { chests, baseChest: "pos:1,2,3" });
    expect(text).toContain("Storage (as last seen):\n- base chest pos:1,2,3: 8 bread\n- chest pos:9,9,9: 16 torch");
    expect(describeSituation(workspace(data()).viewFor("prefrontal"), [], { chests: createChestMemory(), baseChest: "pos:1,2,3" })).toContain("Storage: no chest opened yet");
  });
});
