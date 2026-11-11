import { describe, expect, it } from "vitest";
import type { Skill, State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { SCHEMA_VERSION } from "../encode/encode-state.js";
import type { MinecraftStateData } from "../encode/state-data.js";
import { describeSituation } from "./situation.js";
import { eatWhenStarving, fightOrFlight } from "./reflexes.js";
import { withGoal } from "./instinct.js";

function data(over: { self?: Partial<MinecraftStateData["self"]>; mobs?: MinecraftStateData["nearby"]["mobs"] } = {}): MinecraftStateData {
  return {
    time: { isNight: false, lightLevel: 15 },
    self: {
      health: 20,
      food: 20,
      heldItem: "stone_pickaxe",
      bestWeapon: "stone_sword",
      pickaxeDurabilityPct: 80,
      inventoryFullPct: 10,
      torches: 4,
      foodItems: 2,
      distanceToBase: 12,
      ...over.self,
    },
    nearby: { ores: [{ id: "pos:1,2,3", type: "iron_ore", dist: 5 }], hazards: [], mobs: over.mobs ?? [] },
    current: null,
  };
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
    store.viewFor("neocortex").setGoal({ text: "find iron", steps: ["dig down", "branch mine"], reason: "" });
    expect(withGoal("ctx", store.viewFor("i"))).toBe("ctx\nCurrent goal: find iron Steps: dig down; branch mine.");
  });
});

describe("describeSituation", () => {
  it("describes the bot, its surroundings, recent events and abilities", () => {
    const store = workspace(data({ mobs: [zombie] }));
    store.addEvent({ skill: "mine_block", type: "failed", reason: "no pickaxe", timestamp: 0 });
    const skill = { name: "flee", description: "Run away." } as Skill<unknown>;
    const text = describeSituation(store.viewFor("neocortex"), [skill]);
    expect(text).toContain("Health 20/20, food 20/20 (2 food items).");
    expect(text).toContain("Ores nearby: iron_ore at 5.");
    expect(text).toContain("Mobs nearby: hostile zombie at 4.");
    expect(text).toContain("Recent: mine_block failed (no pickaxe).");
    expect(text).toContain("- flee: Run away.");
  });
});
