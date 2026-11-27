import { describe, expect, it } from "vitest";
import type { State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { SCHEMA_VERSION } from "../encode/encode-state.js";
import type { MinecraftStateData } from "../encode/state-data.js";
import { fakeData } from "../encode/state.test-helper.js";
import { conditionsNote, playerConditions } from "./conditions.js";

type Over = Parameters<typeof fakeData>[0];
function ws(over: Over = {}) {
  const store = createWorkspace();
  const state: State = { schemaVersion: SCHEMA_VERSION, tick: 0, timestamp: 0, data: { ...(fakeData(over) as MinecraftStateData) } };
  store.update(state, null);
  return store.viewFor("motor");
}
const conditions = playerConditions(() => [{ name: "base chest", place: { x: 10, y: 64, z: 0, dimension: "overworld" } }]);
const holds = (text: string, over: Over = {}) => {
  const condition = conditions.parse(text);
  if (!condition) throw new Error(`"${text}" was not understood`);
  return condition.holds(ws(over));
};
const chest = { id: "pos:3,64,0", type: "chest", dist: 3 };
const zombie = { id: "entity:7", type: "zombie", dist: 6, hostile: true, reachable: true };

describe("the player's conditions", () => {
  it("carrying at least so many of an item", () => {
    expect(holds("carrying 3 bread", { self: { inventory: { bread: 3 } } })).toBe(true);
    expect(holds("carrying 3 bread", { self: { inventory: { bread: 2 } } })).toBe(false);
    expect(holds("carrying at least 1 stone sword", { self: { inventory: { stone_sword: 1 } } })).toBe(true);
    expect(holds("carrying 1 bread", { self: { inventory: {} } })).toBe(false);
  });

  it("within a distance of a kind of thing in view", () => {
    expect(holds("within 3 of chest", { nearby: { blocks: [chest] } })).toBe(true);
    expect(holds("within 2 blocks of a chest", { nearby: { blocks: [chest] } })).toBe(false);
    expect(holds("within 3 of chest")).toBe(false);
    expect(holds("within 8 of hostile", { nearby: { mobs: [zombie] } })).toBe(true);
  });

  it("within a distance of a spot, of base, or of a place known by name", () => {
    const at = (x: number) => ({ self: { position: { x, y: 64, z: 0 }, distanceToBase: Math.abs(x) } });
    expect(holds("within 2 of pos:5,64,0", at(4))).toBe(true);
    expect(holds("within 2 of pos:5,64,0", at(0))).toBe(false);
    expect(holds("within 4 of base", at(4))).toBe(true);
    expect(holds("within 4 of base", at(5))).toBe(false);
    expect(holds("within 2 of the base chest", at(9))).toBe(true);
    expect(holds("within 2 of base chest", at(0))).toBe(false);
  });

  it("a need below a level, by its name or by what it is about", () => {
    expect(holds("need food_bar below 0.3", { self: { food: 18 } })).toBe(true);
    expect(holds("need food_bar below 0.3", { self: { food: 10 } })).toBe(false);
    expect(holds("need hunger below 0.3", { self: { food: 18 } })).toBe(true);
    // Every need about safety must be below the level: hurt, the bot is not safe.
    expect(holds("need safety below 0.5", { self: { health: 20 } })).toBe(true);
    expect(holds("need safety below 0.5", { self: { health: 8 } })).toBe(false);
    expect(holds("need nothing_like_it below 0.5")).toBe(false);
  });

  it("the time of day", () => {
    expect(holds("time is night", { time: { isNight: true, lightLevel: 4 } })).toBe(true);
    expect(holds("time is day", { time: { isNight: true, lightLevel: 4 } })).toBe(false);
    expect(holds("time is day")).toBe(true);
  });

  it("something in view, and not", () => {
    expect(holds("sees zombie", { nearby: { mobs: [zombie] } })).toBe(true);
    expect(holds("sees a zombie")).toBe(false);
    expect(holds("not sees zombie")).toBe(true);
    expect(holds("not carrying 1 bread", { self: { inventory: { bread: 4 } } })).toBe(false);
  });

  it("anything else is not understood, and nothing holds before the first state", () => {
    for (const text of ["when the chest is full", "carrying some bread", "within reach of chest", "need hunger under 0.3", "time is noon"]) expect(conditions.parse(text)).toBeNull();
    expect(conditions.parse("time is day")!.holds(createWorkspace().viewFor("motor"))).toBe(false);
    expect(conditions.parse("not time is day")!.holds(createWorkspace().viewFor("motor"))).toBe(true);
  });

  it("is shown to the planner with every form and the needs' names", () => {
    const note = conditionsNote(conditions, ["food_bar", "hunger"]);
    for (const form of conditions.forms) expect(note).toContain(form);
    expect(note).toContain("Needs: food_bar, hunger.");
  });
});
