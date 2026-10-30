import { describe, expect, it } from "vitest";
import type { State } from "@familiar/contracts";
import { isSignificantChange } from "./is-significant-change.js";
import type { MinecraftStateData } from "./state-data.js";

type Patch = { health?: number; inventoryFullPct?: number; mobs?: MinecraftStateData["nearby"]["mobs"]; current?: MinecraftStateData["current"] };

function state(p: Patch = {}): State {
  const data: MinecraftStateData = {
    time: { isNight: false, lightLevel: 15 },
    self: {
      health: p.health ?? 20,
      food: 20,
      heldItem: null,
      bestWeapon: null,
      pickaxeDurabilityPct: null,
      inventoryFullPct: p.inventoryFullPct ?? 50,
      torches: 0,
      foodItems: 0,
      distanceToBase: 0,
    },
    nearby: { ores: [], hazards: [], mobs: p.mobs ?? [] },
    current: p.current === undefined ? { skill: "idle", target: null, secondsRunning: 3 } : p.current,
  };
  return { schemaVersion: 2, tick: 0, timestamp: 0, data: { ...data } };
}

const zombie = (id: number, dist: number) => ({ id: `entity:${id}`, type: "zombie", dist, hostile: true });
const cow = { id: "entity:9", type: "cow", dist: 3, hostile: false };

describe("isSignificantChange", () => {
  it("is false when nothing important changed", () => {
    expect(isSignificantChange(state({ mobs: [zombie(1, 10)] }), state({ mobs: [zombie(1, 6)] }))).toBe(false);
  });

  it("is true for a new hostile mob within 16 blocks", () => {
    expect(isSignificantChange(state(), state({ mobs: [zombie(1, 12)] }))).toBe(true);
    expect(isSignificantChange(state({ mobs: [zombie(1, 20)] }), state({ mobs: [zombie(1, 15)] }))).toBe(true);
  });

  it("ignores far hostiles and passive mobs", () => {
    expect(isSignificantChange(state(), state({ mobs: [zombie(1, 20)] }))).toBe(false);
    expect(isSignificantChange(state(), state({ mobs: [cow] }))).toBe(false);
  });

  it("is true when health drops, not when it rises", () => {
    expect(isSignificantChange(state({ health: 20 }), state({ health: 17 }))).toBe(true);
    expect(isSignificantChange(state({ health: 17 }), state({ health: 20 }))).toBe(false);
  });

  it("is true when the running skill ends", () => {
    expect(isSignificantChange(state(), state({ current: null }))).toBe(true);
    expect(isSignificantChange(state({ current: null }), state({ current: null }))).toBe(false);
  });

  it("is true when the inventory just became full", () => {
    expect(isSignificantChange(state({ inventoryFullPct: 97 }), state({ inventoryFullPct: 100 }))).toBe(true);
    expect(isSignificantChange(state({ inventoryFullPct: 100 }), state({ inventoryFullPct: 100 }))).toBe(false);
  });
});
