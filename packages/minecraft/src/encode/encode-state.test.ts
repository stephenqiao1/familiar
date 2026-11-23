import type { Bot } from "mineflayer";
import { describe, expect, expectTypeOf, it } from "vitest";
import { Vec3 } from "vec3";
import type { EncodableBot, EncodableEntity, EncodableItem } from "./encodable-bot.js";
import { encodeState } from "./encode-state.js";
import type { MinecraftStateData } from "./state-data.js";

const NAMES = ["air", "stone", "lava", "fire", "water", "chest", "wheat", "bell", "cactus", "sand", "magma_block"];
const NOT_SOLID = new Set(["air", "lava", "fire", "water", "wheat"]);
const base = { chest: new Vec3(10, 63, 0), bed: new Vec3(10, 63, 1) };

/** Flat world: stone at y ≤ 62, air above, plus any listed blocks (with crop ages). The bot stands at (0, 63, 0). */
function fakeBot(
  opts: { blocks?: Record<string, string>; ages?: Record<string, number>; entities?: EncodableEntity[]; items?: EncodableItem[] } = {},
): EncodableBot {
  const blocks = new Map(Object.entries(opts.blocks ?? {}));
  const nameAt = (p: Vec3) => blocks.get(`${p.x},${p.y},${p.z}`) ?? (p.y <= 62 ? "stone" : "air");
  const entities = Object.fromEntries((opts.entities ?? []).map((e) => [String(e.id), e]));
  const items = opts.items ?? [];
  return {
    health: 18,
    food: 15,
    heldItem: { name: "stone_sword" },
    entity: { id: 1, position: new Vec3(0.5, 63, 0.5) },
    time: { isDay: true },
    game: { dimension: "overworld" },
    isSleeping: false,
    inventory: { items: () => items },
    entities,
    registry: {
      blocksArray: NAMES.map((name, id) => ({ name, minStateId: id, maxStateId: id, boundingBox: NOT_SOLID.has(name) ? "empty" : "block" })),
      biomes: { 7: { name: "plains" } },
      foodsByName: { cooked_beef: { foodPoints: 8, saturation: 12.8 }, rotten_flesh: { foodPoints: 4, saturation: 0.8 } },
    },
    blockAt(pos) {
      const p = pos.floored();
      const name = nameAt(p);
      const age = opts.ages?.[`${p.x},${p.y},${p.z}`];
      return {
        name,
        boundingBox: NOT_SOLID.has(name) ? "empty" : "block",
        light: 0,
        skyLight: pos.y >= 63 ? 15 : 0,
        biome: { id: 7, name: "" }, // newer versions leave the name empty: it is looked up by id
        getProperties: (): Record<string, number> => (age === undefined ? {} : { age }),
      };
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
  encodeState(bot, 7, { base, current, deaths: 0 }).data as unknown as MinecraftStateData;

describe("encodeState", () => {
  it("encodes a zombie, a cow and lava nearby", () => {
    const bot = fakeBot({
      blocks: { "0,62,5": "lava" },
      entities: [mob(42, "zombie", "hostile", 6, 0), mob(43, "cow", "animal", 0, -4)],
      items: [item("stone_sword", 1, 36, 33, 131), item("torch", 8, 1), item("cooked_beef", 5, 2), item("rotten_flesh", 3, 3)],
    });
    const state = encodeState(bot, 7, { base, current: null, deaths: 2 });

    expect(state).toMatchObject({ schemaVersion: 18, tick: 7 });
    expect(state.data).toEqual({
      time: { isNight: false, lightLevel: 15, blockLight: 0 },
      self: {
        position: { x: 0, y: 63, z: 0 },
        dimension: "overworld",
        health: 18,
        food: 15,
        heldItem: "stone_sword",
        bestWeapon: "stone_sword",
        inventoryFullPct: 11,
        foodItems: 5,
        badFoodItems: 3,
        saturation: 0,
        effects: [],
        freezing: 0,
        sinceSleepMinutes: 0,
        healing: false,
        inventory: { stone_sword: 1, torch: 8, cooked_beef: 5, rotten_flesh: 3 },
        distanceToBase: 10,
        biome: "plains",
        skyLight: 15,
        enclosed: false,
        asleep: false,
        deaths: 2,
        air: 20,
        onFire: false,
        inLava: false,
        inWater: false,
        falling: false,
        lastHurt: null,
        touching: { feet: "air", head: "air", below: "stone", sides: ["air", "air", "air", "air"] },
        inBlock: false,
        pushed: null,
        motion: null,
        gaze: { id: "entity:43", yaw: 0 },
        support: { on: "stone", kind: "solid", edges: 0, headroom: 3 },
        velocity: { x: 0, y: 0, z: 0, onGround: true },
        landing: null,
        displaced: false,
        balance: 1,
        locomotion: { moving: false, pattern: null, gait: "walk", stuck: false },
      },
      nearby: {
        hazards: [{ id: "pos:0,62,5", type: "lava", dist: 5 }],
        mobs: [
          { id: "entity:43", type: "cow", dist: 4, hostile: false, reachable: true, bearing: { side: "ahead", angle: 0 }, seen: true, closing: 0 },
          { id: "entity:42", type: "zombie", dist: 6, hostile: true, reachable: true, bearing: { side: "right", angle: -90 }, seen: true, closing: 0 },
        ],
        blocks: [],
        players: [],
        sudden: [],
        heard: [],
      },
      memory: null,
      current: null,
    });
  });

  it("gives empty lists, not missing keys, in an empty world", () => {
    const data = dataOf(fakeBot());
    expect(data.nearby).toEqual({ hazards: [], mobs: [], blocks: [], players: [], sudden: [], heard: [] });
    expect(data.self).toMatchObject({ bestWeapon: null, foodItems: 0, inventoryFullPct: 0, inventory: {} });
    expect(data.current).toBeNull();
  });

  it("reports a drop of 3+ blocks but not a shallow dip", () => {
    const blocks: Record<string, string> = { "4,62,0": "air", "4,61,0": "air", "4,60,0": "air", "-4,62,0": "air" };
    const hazards = dataOf(fakeBot({ blocks })).nearby.hazards;
    expect(hazards).toEqual([{ id: "pos:4,63,0", type: "drop", dist: 4 }]);
  });

  describe("enclosed", () => {
    /** A stone box around the bot (who stands at 0,63,0, head at y 64): walls at x and z ±3, roof at y 66, minus any gaps. */
    function room(gaps: string[] = []): Record<string, string> {
      const blocks: Record<string, string> = {};
      for (let x = -3; x <= 3; x++) {
        for (let z = -3; z <= 3; z++) {
          for (let y = 63; y <= 66; y++) {
            const wall = Math.abs(x) === 3 || Math.abs(z) === 3 || y === 66;
            if (wall) blocks[`${x},${y},${z}`] = "stone";
          }
        }
      }
      for (const gap of gaps) delete blocks[gap];
      return blocks;
    }
    const enclosed = (blocks?: Record<string, string>) => dataOf(fakeBot(blocks ? { blocks } : {})).self.enclosed;

    it("is true inside a closed room, and with one side open (a doorway, a missing wall)", () => {
      expect(enclosed(room())).toBe(true);
      expect(enclosed(room(["3,64,0"]))).toBe(true);
    });

    it("is false in the open, with no roof overhead, or with two sides open", () => {
      expect(enclosed()).toBe(false);
      expect(enclosed(room(["0,66,0"]))).toBe(false);
      expect(enclosed(room(["3,64,0", "0,64,3"]))).toBe(false);
    });

    it("is false under a roof with no walls (e.g. a tree)", () => {
      const canopy: Record<string, string> = {};
      for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) canopy[`${x},66,${z}`] = "stone";
      expect(enclosed(canopy)).toBe(false);
    });

    it("does not count a roof or walls more than 6 blocks away", () => {
      const far: Record<string, string> = { "0,71,0": "stone", "7,64,0": "stone", "-7,64,0": "stone", "0,64,7": "stone", "0,64,-7": "stone" };
      expect(enclosed(far)).toBe(false);
      const near: Record<string, string> = { "0,70,0": "stone", "6,64,0": "stone", "-6,64,0": "stone", "0,64,6": "stone" };
      expect(enclosed(near)).toBe(true);
    });

    it("is false when the surroundings are not loaded", () => {
      const bot = fakeBot({ blocks: room() });
      bot.world.getBlockStateId = () => undefined;
      expect(dataOf(bot).self.enclosed).toBe(false);
    });
  });

  it("lists chests, bells and ripe crops, but not unripe ones", () => {
    const blocks = { "3,63,0": "chest", "0,63,6": "bell", "2,63,2": "wheat", "-2,63,2": "wheat" };
    const ages = { "2,63,2": 7, "-2,63,2": 3 };
    expect(dataOf(fakeBot({ blocks, ages })).nearby.blocks.map(({ id, type, dist }) => ({ id, type, dist }))).toEqual([
      { id: "pos:2,63,2", type: "wheat", dist: 2 },
      { id: "pos:3,63,0", type: "chest", dist: 3 },
      { id: "pos:0,63,6", type: "bell", dist: 6 },
    ]);
  });

  it("leaves out things beyond range, and lists players apart from mobs", () => {
    const data = dataOf(
      fakeBot({
        blocks: { "9,62,0": "lava" },
        entities: [mob(5, "zombie", "hostile", 25, 0), mob(6, "Steve", "player", 2, 0), mob(7, "Alex", "player", 30, 0)],
      }),
    );
    expect(data.nearby).toEqual({ hazards: [], mobs: [], blocks: [], players: [{ id: "entity:6", type: "player", dist: 2, bearing: { side: "right", angle: -90 }, seen: true, closing: 0 }], sudden: [], heard: [] });
  });

  it("dims the sky's light at night", () => {
    const bot = fakeBot();
    expect(dataOf(bot).time).toEqual({ isNight: false, lightLevel: 15, blockLight: 0 });
    bot.time.isDay = false;
    expect(dataOf(bot).time).toEqual({ isNight: true, lightLevel: 4, blockLight: 0 });
  });

  it("passes on how the place feels from memory", () => {
    const state = encodeState(fakeBot(), 0, { base, current: null, deaths: 0, memory: { nearby: "bad", kind: "danger" } });
    expect((state.data as unknown as MinecraftStateData).memory).toEqual({ nearby: "bad", kind: "danger" });
  });

  it("reports the running skill", () => {
    const startedAt = Date.now() - 4200;
    const data = encodeState(fakeBot(), 0, { base, current: { skill: "go_to", target: "pos:1,2,3", startedAt }, deaths: 0 })
      .data as unknown as MinecraftStateData;
    expect(data.current).toEqual({ skill: "go_to", target: "pos:1,2,3", secondsRunning: 4 });
  });

  describe("in a busy world", () => {
    const blocks: Record<string, string> = {};
    for (let i = 0; i < 30; i++) blocks[`${(i % 6) - 3},62,${6 + Math.floor(i / 6)}`] = "lava";
    for (let x = -8; x <= 8; x++) for (let y = 59; y <= 62; y++) blocks[`${x},${y},-7`] = "air"; // a trench
    const entities = Array.from({ length: 40 }, (_, i) => mob(100 + i, i % 2 ? "zombie" : "skeleton", "hostile", (i % 10) - 5, Math.floor(i / 10) * 3));
    const items = Array.from({ length: 36 }, (_, i) => item(i === 0 ? "diamond_sword" : "cobblestone", 64, i, 10, 1561));
    const bot = fakeBot({ blocks, entities, items });

    it("stays under 4 KB of JSON (and caps each list at 10)", () => {
      const state = encodeState(bot, 123456, { base, current: { skill: "go_to", target: "pos:1,2,3", startedAt: Date.now() }, deaths: 0 });
      const json = JSON.stringify(state);
      const data = state.data as unknown as MinecraftStateData;
      expect(data.nearby.hazards).toHaveLength(10);
      expect(data.nearby.mobs).toHaveLength(10);
      // Each nearby thing now carries its bearing, whether it is seen and how fast it is closing.
      expect(json.length).toBeLessThan(4 * 1024);
    });

    it("encodes in under 20 ms", () => {
      encodeState(bot, 0, { base, current: null, deaths: 0 }); // warm up
      const runs = 20;
      const start = performance.now();
      for (let i = 0; i < runs; i++) encodeState(bot, i, { base, current: null, deaths: 0 });
      expect((performance.now() - start) / runs).toBeLessThan(20);
    });
  });

  it("is satisfied by a real mineflayer Bot", () => {
    expectTypeOf<Bot>().toExtend<EncodableBot>();
  });

  describe("the body's senses", () => {
    const self = (bot: EncodableBot, ctx: Partial<Parameters<typeof encodeState>[2]> = {}) =>
      (encodeState(bot, 0, { base, current: null, deaths: 0, ...ctx }).data as unknown as MinecraftStateData).self;

    it("reports air, and full air when the bot does not say", () => {
      const diver = fakeBot();
      diver.entity.metadata = [0, 105]; // 105 ticks of air left of 300
      expect(self(diver).air).toBe(7);
      expect(self(fakeBot()).air).toBe(20);
    });

    it("knows when the feet or head are in lava or water", () => {
      expect(self(fakeBot({ blocks: { "0,63,0": "lava" } }))).toMatchObject({ inLava: true, inWater: false });
      expect(self(fakeBot({ blocks: { "0,64,0": "water" } }))).toMatchObject({ inLava: false, inWater: true });
      expect(self(fakeBot())).toMatchObject({ inLava: false, inWater: false });
    });

    it("is on fire when the server flags it, or when standing in fire", () => {
      const flagged = fakeBot();
      flagged.entity.metadata = [1];
      expect(self(flagged).onFire).toBe(true);
      expect(self(fakeBot({ blocks: { "0,63,0": "fire" } })).onFire).toBe(true);
      expect(self(fakeBot()).onFire).toBe(false);
    });

    it("is falling only off the ground with 3 or more open blocks below", () => {
      const pit = { "0,62,0": "air", "0,61,0": "air", "0,60,0": "air" };
      const airborne = (blocks: Record<string, string>, onGround: boolean) => {
        const bot = fakeBot({ blocks });
        bot.entity.onGround = onGround;
        return self(bot).falling;
      };
      expect(airborne(pit, false)).toBe(true);
      expect(airborne(pit, true)).toBe(false);
      expect(airborne({ "0,62,0": "air" }, false)).toBe(false); // a one-block hop
    });

    it("reports who last hurt the bot and how long ago, for a minute", () => {
      const now = Date.now();
      const hurt = (at: number, by: string | null, kind: string | null) => ({ at, by, kind, where: { x: 3, y: 63, z: -2 }, touching: { feet: "air", head: "air", below: "sand", sides: ["cactus", "air", "air", "air"] } });
      expect(self(fakeBot(), { lastHurt: hurt(now - 500, "entity:9", "mob_attack") }).lastHurt).toMatchObject({ by: "entity:9", kind: "mob_attack" });
      // No attacker: the game's own name for the damage, and where it happened.
      expect(self(fakeBot(), { lastHurt: hurt(now - 500, null, "cactus") }).lastHurt).toMatchObject({ by: null, kind: "cactus", at: { x: 3, y: 63, z: -2 } });
      expect(self(fakeBot(), { lastHurt: hurt(now - 120_000, "entity:9", "mob_attack") }).lastHurt).toBeNull();
    });

    it("feels what it is touching: at the feet, at the head, under the feet and on the four sides", () => {
      const bot = fakeBot({ blocks: { "1,63,0": "cactus", "0,62,0": "sand", "0,64,0": "water" } });
      expect(self(bot).touching).toEqual({ feet: "air", head: "water", below: "sand", sides: ["cactus", "air", "air", "air"] });
    });

    it("knows when its head is inside a solid block", () => {
      expect(self(fakeBot({ blocks: { "0,64,0": "sand" } })).inBlock).toBe(true);
      expect(self(fakeBot()).inBlock).toBe(false);
    });

    it("reports a push, with the first danger within 2 blocks that way: a drop, or a block known to hurt", () => {
      const pit = Object.fromEntries([62, 61, 60, 59].map((y) => [`2,${y},0`, "air"]));
      const east = { blocks: 0.7, toward: { x: 1, z: 0 } };
      expect(self(fakeBot({ blocks: pit }), { pushed: east }).pushed).toEqual({ ...east, danger: { what: "drop", blocks: 2 } });
      expect(self(fakeBot({ blocks: { "1,63,0": "cactus" } }), { pushed: east }).pushed?.danger).toEqual({ what: "cactus", blocks: 1 });
      expect(self(fakeBot({ blocks: { "1,62,0": "magma_block" } }), { pushed: east }).pushed?.danger).toEqual({ what: "magma_block", blocks: 1 });
      // Pushed in the open: no danger. Not pushed: nothing.
      expect(self(fakeBot(), { pushed: east }).pushed).toEqual({ ...east, danger: null });
      expect(self(fakeBot()).pushed).toBeNull();
    });

    it("reports which way it is moving, with the danger ahead; a wall ends the look", () => {
      const north = { x: 0, z: -1 };
      expect(self(fakeBot({ blocks: { "0,63,-2": "lava" } }), { motion: north }).motion).toEqual({ toward: north, danger: { what: "lava", blocks: 2 } });
      const walled = { "0,63,-1": "stone", "0,64,-1": "stone", "0,63,-2": "lava" };
      expect(self(fakeBot({ blocks: walled }), { motion: north }).motion?.danger).toBeNull();
      expect(self(fakeBot()).motion).toBeNull();
    });

    it("lists blocks the bot knows hurt within 3 blocks among the hazards", () => {
      const data = encodeState(fakeBot({ blocks: { "2,63,0": "cactus", "6,63,0": "cactus" } }), 0, { base, current: null, deaths: 0 }).data as unknown as MinecraftStateData;
      expect(data.nearby.hazards).toEqual([{ id: "pos:2,63,0", type: "cactus", dist: 2 }]);
    });

    it("reports the food reserve, the status effects, freezing, time since sleep and healing", () => {
      const ill = fakeBot();
      ill.foodSaturation = 7.25;
      ill.entity.effects = { 18: { id: 18 }, 16: { id: 16 } };
      ill.registry.effects = { 18: { name: "Poison" }, 16: { name: "Hunger" }, 3: { name: "Mining Fatigue" } };
      ill.entity.metadata = [0, 300, 0, 0, 0, 0, 0, 70];
      expect(self(ill, { sinceSleepMinutes: 900, healing: true })).toMatchObject({ saturation: 7.3, effects: ["hunger", "poison"], freezing: 0.5, sinceSleepMinutes: 900, healing: true });
      expect(self(fakeBot())).toMatchObject({ saturation: 0, effects: [], freezing: 0, sinceSleepMinutes: 0, healing: false });
    });

    it("counts food known to be bad apart from the rest", () => {
      const bot = fakeBot({ items: [item("cooked_beef", 5, 2), item("rotten_flesh", 3, 3)] });
      expect(self(bot)).toMatchObject({ foodItems: 5, badFoodItems: 3 });
    });

    it("marks a hostile unreachable when a wall is in the way or it is far above or below", () => {
      const walled = fakeBot({ entities: [mob(42, "zombie", "hostile", 5, 0)] });
      walled.world.raycast = () => ({ name: "stone" });
      expect(dataOf(walled).nearby.mobs[0]).toMatchObject({ reachable: false });
      const open = fakeBot({ entities: [mob(42, "zombie", "hostile", 5, 0)] });
      open.world.raycast = () => null;
      expect(dataOf(open).nearby.mobs[0]).toMatchObject({ reachable: true });
      const above = fakeBot({ entities: [{ ...mob(42, "zombie", "hostile", 5, 0), position: new Vec3(5.5, 70, 0.5) }] });
      expect(dataOf(above).nearby.mobs[0]).toMatchObject({ reachable: false });
    });
  });
});
