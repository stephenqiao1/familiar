import type { Bot } from "mineflayer";
import { describe, expect, expectTypeOf, it } from "vitest";
import { Vec3 } from "vec3";
import type { EncodableBot, EncodableEntity, EncodableItem } from "./encodable-bot.js";
import { encodeState } from "./encode-state.js";
import type { MinecraftStateData } from "./state-data.js";

const NAMES = ["air", "stone", "iron_ore", "coal_ore", "diamond_ore", "lava", "fire", "water", "chest"];
const NOT_SOLID = new Set(["air", "lava", "fire", "water"]);
const base = { chest: new Vec3(10, 63, 0), bed: new Vec3(10, 63, 1) };

/** Flat world: stone at y ≤ 62, air above, plus any listed blocks. The bot stands at (0, 63, 0). */
function fakeBot(opts: { blocks?: Record<string, string>; entities?: EncodableEntity[]; items?: EncodableItem[] } = {}): EncodableBot {
  const blocks = new Map(Object.entries(opts.blocks ?? {}));
  const nameAt = (p: Vec3) => blocks.get(`${p.x},${p.y},${p.z}`) ?? (p.y <= 62 ? "stone" : "air");
  const entities = Object.fromEntries((opts.entities ?? []).map((e) => [String(e.id), e]));
  const items = opts.items ?? [];
  return {
    health: 18,
    food: 15,
    heldItem: { name: "stone_pickaxe" },
    entity: { id: 1, position: new Vec3(0.5, 63, 0.5) },
    time: { isDay: true },
    inventory: { items: () => items },
    entities,
    registry: {
      blocksArray: NAMES.map((name, id) => ({ name, minStateId: id, maxStateId: id })),
      foodsByName: { cooked_beef: { foodPoints: 8, saturation: 12.8 }, rotten_flesh: { foodPoints: 4, saturation: 0.8 } },
    },
    blockAt(pos) {
      const name = nameAt(pos.floored());
      return { name, boundingBox: NOT_SOLID.has(name) ? "empty" : "block", light: 0, skyLight: pos.y >= 63 ? 15 : 0 };
    },
    world: { getBlockStateId: (pos) => NAMES.indexOf(nameAt(pos.floored())) },
  };
}

const item = (name: string, count = 1, slot = 0, durabilityUsed = 0, maxDurability = 0): EncodableItem => ({
  name,
  count,
  slot,
  durabilityUsed,
  maxDurability,
});
const mob = (id: number, name: string, type: string, x: number, z: number): EncodableEntity => ({
  id,
  name,
  type,
  position: new Vec3(x + 0.5, 63, z + 0.5),
});
const dataOf = (bot: EncodableBot, current = null) =>
  encodeState(bot, 7, { base, current }).data as unknown as MinecraftStateData;

describe("encodeState", () => {
  it("encodes a zombie, iron ore and lava nearby", () => {
    const bot = fakeBot({
      blocks: { "3,62,0": "iron_ore", "0,62,5": "lava" },
      entities: [mob(42, "zombie", "hostile", 6, 0), mob(43, "cow", "animal", 0, -4)],
      items: [item("stone_pickaxe", 1, 36, 33, 131), item("torch", 8, 1), item("cooked_beef", 5, 2), item("rotten_flesh", 3, 3)],
    });
    const state = encodeState(bot, 7, { base, current: null });

    expect(state).toMatchObject({ schemaVersion: 2, tick: 7 });
    expect(state.data).toEqual({
      time: { isNight: false, lightLevel: 15 },
      self: {
        health: 18,
        food: 15,
        heldItem: "stone_pickaxe",
        bestWeapon: "stone_pickaxe",
        pickaxeDurabilityPct: 75,
        inventoryFullPct: 11,
        torches: 8,
        foodItems: 5,
        distanceToBase: 10,
      },
      nearby: {
        ores: [{ id: "pos:3,62,0", type: "iron_ore", dist: 3 }],
        hazards: [{ id: "pos:0,62,5", type: "lava", dist: 5 }],
        mobs: [
          { id: "entity:43", type: "cow", dist: 4, hostile: false },
          { id: "entity:42", type: "zombie", dist: 6, hostile: true },
        ],
      },
      current: null,
    });
  });

  it("gives empty lists, not missing keys, in an empty world", () => {
    const data = dataOf(fakeBot());
    expect(data.nearby).toEqual({ ores: [], hazards: [], mobs: [] });
    expect(data.self).toMatchObject({ bestWeapon: null, pickaxeDurabilityPct: null, torches: 0, foodItems: 0, inventoryFullPct: 0 });
    expect(data.current).toBeNull();
  });

  it("reports a drop of 3+ blocks but not a shallow dip", () => {
    const blocks: Record<string, string> = { "4,62,0": "air", "4,61,0": "air", "4,60,0": "air", "-4,62,0": "air" };
    const hazards = dataOf(fakeBot({ blocks })).nearby.hazards;
    expect(hazards).toEqual([{ id: "pos:4,63,0", type: "drop", dist: 4 }]);
  });

  it("leaves out things beyond range and players", () => {
    const data = dataOf(
      fakeBot({
        blocks: { "17,63,0": "iron_ore", "9,62,0": "lava" },
        entities: [mob(5, "zombie", "hostile", 25, 0), mob(6, "Steve", "player", 2, 0)],
      }),
    );
    expect(data.nearby).toEqual({ ores: [], hazards: [], mobs: [] });
  });

  it("reports the running skill", () => {
    const startedAt = Date.now() - 4200;
    const data = encodeState(fakeBot(), 0, { base, current: { skill: "go_to", target: "pos:1,2,3", startedAt } })
      .data as unknown as MinecraftStateData;
    expect(data.current).toEqual({ skill: "go_to", target: "pos:1,2,3", secondsRunning: 4 });
  });

  describe("in a busy world", () => {
    const blocks: Record<string, string> = {};
    for (let i = 0; i < 60; i++) blocks[`${(i % 12) - 6},${55 + (i % 7)},${Math.floor(i / 12) - 3}`] = i % 3 ? "coal_ore" : "diamond_ore";
    for (let i = 0; i < 30; i++) blocks[`${(i % 6) - 3},62,${6 + Math.floor(i / 6)}`] = "lava";
    for (let x = -8; x <= 8; x++) for (let y = 59; y <= 62; y++) blocks[`${x},${y},-7`] = "air"; // a trench
    const entities = Array.from({ length: 40 }, (_, i) => mob(100 + i, i % 2 ? "zombie" : "skeleton", "hostile", (i % 10) - 5, Math.floor(i / 10) * 3));
    const items = Array.from({ length: 36 }, (_, i) => item(i === 0 ? "diamond_pickaxe" : "cobblestone", 64, i, 10, 1561));
    const bot = fakeBot({ blocks, entities, items });

    it("stays under 3 KB of JSON (and caps each list at 10)", () => {
      const state = encodeState(bot, 123456, { base, current: { skill: "dig_tunnel", target: "west", startedAt: Date.now() } });
      const json = JSON.stringify(state);
      const data = state.data as unknown as MinecraftStateData;
      expect(data.nearby.ores).toHaveLength(10);
      expect(data.nearby.hazards).toHaveLength(10);
      expect(data.nearby.mobs).toHaveLength(10);
      expect(json.length).toBeLessThan(3 * 1024);
    });

    it("encodes in under 20 ms", () => {
      encodeState(bot, 0, { base, current: null }); // warm up
      const runs = 20;
      const start = performance.now();
      for (let i = 0; i < runs; i++) encodeState(bot, i, { base, current: null });
      expect((performance.now() - start) / runs).toBeLessThan(20);
    });
  });

  it("is satisfied by a real mineflayer Bot", () => {
    expectTypeOf<Bot>().toExtend<EncodableBot>();
  });
});
