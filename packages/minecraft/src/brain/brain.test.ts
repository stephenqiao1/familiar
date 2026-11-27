import { describe, expect, it } from "vitest";
import type { Skill, State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { SCHEMA_VERSION } from "../encode/encode-state.js";
import type { MinecraftStateData } from "../encode/state-data.js";
import { fakeData } from "../encode/state.test-helper.js";
import { createChestMemory } from "../chest-memory.js";
import { describeSituation } from "./situation.js";
import type { ReflexRule } from "@familiar/region-reflex";
import { drowning, inLavaOrFire, lastStand, playerReflexes } from "./reflexes.js";
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

const zombie = { id: "entity:7", type: "zombie", dist: 6, hostile: true, reachable: true };
const check = (rule: ReflexRule, d: MinecraftStateData) => rule.check(workspace(d).viewFor("reflex"));

describe("hard reflexes", () => {
  it("in lava, or on fire: escapes the hazard", () => {
    expect(check(inLavaOrFire, data({ self: { inLava: true } }))).toMatchObject({ action: { skill: "escape_hazard" }, reason: "in lava" });
    expect(check(inLavaOrFire, data({ self: { onFire: true } }))).toMatchObject({ action: { skill: "escape_hazard" }, reason: "on fire" });
    expect(check(inLavaOrFire, data())).toBeNull();
  });

  it("low on air under water: surfaces", () => {
    expect(check(drowning, data({ self: { inWater: true, air: 6 } }))).toMatchObject({ action: { skill: "surface" } });
    expect(check(drowning, data({ self: { inWater: true, air: 7 } }))).toBeNull();
    // Getting its breath back on land is not drowning.
    expect(check(drowning, data({ self: { inWater: false, air: 3 } }))).toBeNull();
  });

  it("nearly dead with a hostile within 4 blocks: breaks away", () => {
    const close = { ...zombie, dist: 4 };
    expect(check(lastStand, data({ self: { health: 6 }, mobs: [close] }))).toMatchObject({ action: { skill: "flee", target: "entity:7" } });
    expect(check(lastStand, data({ self: { health: 7 }, mobs: [close] }))).toBeNull();
    expect(check(lastStand, data({ self: { health: 6 }, mobs: [{ ...zombie, dist: 5 }] }))).toBeNull();
  });

  it("are the only hard rules, and every other rule is soft", () => {
    expect(playerReflexes.filter((r) => r.kind === "hard").map((r) => r.name)).toEqual(["in_lava_or_fire", "drowning", "last_stand", "cornered_fight", "pain_withdrawal", "buried", "about_to_touch", "falling_right"]);
    expect(playerReflexes.filter((r) => r.kind === "soft").map((r) => r.name)).toEqual(["defence_fight", "defence_flee", "defence_freeze", "recuperate", "hold_ground", "edge_guard"]);
  });
});

describe("withGoal", () => {
  it("adds the goal and steps to the context", () => {
    const store = workspace(data());
    expect(withGoal("ctx", store.viewFor("i"))).toBe("ctx");
    store.viewFor("prefrontal").setGoal({ text: "build a shelter", steps: ["gather wood", "build walls"], reason: "" });
    expect(withGoal("ctx", store.viewFor("i"))).toBe("ctx\nCurrent goal: build a shelter Steps: gather wood; build walls.");
  });

  it("takes the goal it is handed (the feedback of the area above) in place of the workspace's", () => {
    const store = workspace(data());
    store.viewFor("prefrontal").setGoal({ text: "build", steps: [], reason: "" });
    const ws = store.viewFor("i");
    expect(withGoal("ctx", ws, { ...ws.goal!, text: "hide" })).toBe("ctx\nCurrent goal: hide");
    expect(withGoal("ctx", ws, null)).toBe("ctx");
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
    expect(text).toContain("Mobs nearby: hostile zombie at 6.");
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
