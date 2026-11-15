import { describe, expect, it } from "vitest";
import type { State } from "@familiar/contracts";
import { isSignificantChange } from "./is-significant-change.js";
import type { MinecraftStateData } from "./state-data.js";
import { fakeState } from "./state.test-helper.js";

type Patch = { health?: number; inventoryFullPct?: number; mobs?: MinecraftStateData["nearby"]["mobs"]; current?: MinecraftStateData["current"] };

/** A half-full bot that is idling unless told otherwise. */
function state(p: Patch = {}): State {
  return fakeState({
    self: { health: p.health ?? 20, inventoryFullPct: p.inventoryFullPct ?? 50 },
    nearby: { mobs: p.mobs ?? [] },
    current: p.current === undefined ? { skill: "idle", target: null, secondsRunning: 3 } : p.current,
  });
}

const zombie = (id: number, dist: number) => ({ id: `entity:${id}`, type: "zombie", dist, hostile: true, reachable: true });
const cow = { id: "entity:9", type: "cow", dist: 3, hostile: false, reachable: true };

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

describe("isSignificantChange: the body", () => {
  const state = (self: Partial<MinecraftStateData["self"]> = {}, loud: MinecraftStateData["nearby"]["loud"] = []) => fakeState({ self, nearby: { loud } });

  it("is true when the bot is hurt again, catches fire, falls into lava or runs low on air", () => {
    expect(isSignificantChange(state(), state({ lastHurt: { msAgo: 10, by: null } }))).toBe(true);
    expect(isSignificantChange(state({ lastHurt: { msAgo: 900, by: null } }), state({ lastHurt: { msAgo: 20, by: null } }))).toBe(true);
    expect(isSignificantChange(state(), state({ onFire: true }))).toBe(true);
    expect(isSignificantChange(state(), state({ inLava: true }))).toBe(true);
    expect(isSignificantChange(state({ air: 7 }), state({ air: 6 }))).toBe(true);
  });

  it("is true when something loud happens", () => {
    expect(isSignificantChange(state(), state({}, [{ type: "explosion", dist: 9 }]))).toBe(true);
  });

  it("is false while those simply continue", () => {
    expect(isSignificantChange(state({ lastHurt: { msAgo: 100, by: null } }), state({ lastHurt: { msAgo: 600, by: null } }))).toBe(false);
    expect(isSignificantChange(state({ onFire: true, air: 5 }), state({ onFire: true, air: 4 }))).toBe(false);
  });
});
