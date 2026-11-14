import type { State } from "@familiar/contracts";
import { describe, expect, it } from "vitest";
import type { MinecraftStateData } from "../encode/state-data.js";
import { fakeState } from "../encode/state.test-helper.js";
import { situationOf } from "./situation-labels.js";

type Patch = { self?: Partial<MinecraftStateData["self"]>; isNight?: boolean; mobs?: MinecraftStateData["nearby"]["mobs"]; players?: number };

/** A bot 40 blocks from base. */
function state(p: Patch = {}): State {
  const players = Array.from({ length: p.players ?? 0 }, (_, i) => ({ id: `entity:${i}`, type: "player", dist: 5 }));
  return fakeState({ time: { isNight: p.isNight ?? false }, self: { distanceToBase: 40, ...p.self }, nearby: { mobs: p.mobs ?? [], players } });
}

describe("situationOf", () => {
  it("labels a calm day on the surface", () => {
    expect(situationOf(state())).toBe("day/safe/fed/surface/alone");
  });

  it("labels a bad night underground with company", () => {
    const zombie = { id: "entity:1", type: "zombie", dist: 5, hostile: true };
    expect(situationOf(state({ isNight: true, mobs: [zombie], self: { food: 6, skyLight: 0 }, players: 2 }))).toBe(
      "night/threatened/hungry/underground/with_others",
    );
  });

  it("counts being near base as at base, even with no sky above", () => {
    expect(situationOf(state({ self: { distanceToBase: 3, skyLight: 0 } }))).toBe("day/safe/fed/at_base/alone");
  });

  it("ignores far or friendly mobs", () => {
    const far = { id: "entity:1", type: "zombie", dist: 20, hostile: true };
    const cow = { id: "entity:2", type: "cow", dist: 2, hostile: false };
    expect(situationOf(state({ mobs: [far, cow] }))).toBe("day/safe/fed/surface/alone");
  });

  it("is unknown before the first Minecraft state", () => {
    expect(situationOf({ schemaVersion: 0, tick: 0, timestamp: 0, data: {} })).toBe("unknown");
  });
});
