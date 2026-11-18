import { EventEmitter } from "node:events";
import type { Bot } from "mineflayer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Vec3 } from "vec3";
import { headingFor, trackSenses } from "../senses.js";
import { bearingOf } from "./bearing.js";
import type { EncodableBot } from "./encodable-bot.js";
import { encodeState } from "./encode-state.js";
import type { MinecraftStateData } from "./state-data.js";

const base = { chest: new Vec3(10, 63, 0), bed: new Vec3(10, 63, 1) };

/**
 * A flat world (stone at y <= 62) with listed solid blocks and entities, a bot at 0,63,0 facing
 * north (-z), and rays that stop at solid blocks. It also emits the events the senses listen for.
 */
function world(opts: { walls?: string[]; yaw?: number } = {}) {
  const events = new EventEmitter();
  const client = new EventEmitter();
  const walls = new Set(opts.walls ?? []);
  const solid = (p: Vec3) => p.y <= 62 || walls.has(`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`);
  const entities: Record<string, { id: number; name: string; type: string; position: Vec3; velocity: Vec3; height: number }> = {};
  const me = { id: 1, position: new Vec3(0.5, 63, 0.5), yaw: opts.yaw ?? 0, onGround: true, velocity: new Vec3(0, 0, 0) };
  const block = (p: Vec3) => ({ name: solid(p) ? "stone" : "air", boundingBox: solid(p) ? "block" : "empty", light: 15, skyLight: 15, position: p.floored(), getProperties: () => ({}) });
  const state = {
    health: 20,
    food: 20,
    heldItem: null,
    entity: me,
    time: { isDay: true },
    game: { dimension: "overworld" },
    isSleeping: false,
    inventory: { items: () => [] },
    entities,
    registry: { blocksArray: [], foodsByName: {} },
    blockAt: block,
    world: {
      getBlockStateId: () => 0,
      raycast(from: Vec3, direction: Vec3, range: number) {
        for (let d = 0; d <= range; d += 0.25) if (solid(from.plus(direction.scaled(d)))) return {};
        return null;
      },
    },
    on: (name: string, fn: (...args: unknown[]) => void) => events.on(name, fn),
    _client: client,
  };
  const add = (id: number, name: string, type: string, x: number, z: number, y = 63) => (entities[id] = { id, name, type, position: new Vec3(x + 0.5, y, z + 0.5), velocity: new Vec3(0, 0, 0), height: 1.8 });
  const bot = state as unknown as Bot & EncodableBot;
  const senses = trackSenses(bot);
  /** Advances `ms`, moving each listed entity at its speed (blocks a second) along x and z. */
  async function run(ms: number, moves: Record<number, [number, number]> = {}) {
    for (let t = 0; t < ms; t += 50) {
      for (const [id, [vx, vz]] of Object.entries(moves)) entities[id]!.position = entities[id]!.position.offset(vx / 20, 0, vz / 20);
      events.emit("physicsTick");
      await vi.advanceTimersByTimeAsync(50);
    }
  }
  const data = () => encodeState(bot, 0, { base, current: null, deaths: 0, senses }).data as unknown as MinecraftStateData;
  return { bot, me, add, run, data, senses, emit: (name: string, ...args: unknown[]) => events.emit(name, ...args), packet: (name: string, p: unknown) => client.emit(name, p) };
}

describe("bearingOf", () => {
  const from = new Vec3(0, 63, 0);
  it("gives the side and the angle relative to where the head faces", () => {
    // Facing north (-z): east is to the right, west to the left.
    expect(bearingOf(from, 0, new Vec3(0, 63, -5))).toEqual({ side: "ahead", angle: 0 });
    expect(bearingOf(from, 0, new Vec3(5, 63, 0))).toEqual({ side: "right", angle: -90 });
    expect(bearingOf(from, 0, new Vec3(-5, 63, 0))).toEqual({ side: "left", angle: 90 });
    expect(bearingOf(from, 0, new Vec3(0, 63, 5))).toEqual({ side: "behind", angle: 180 });
    expect(bearingOf(from, 0, new Vec3(3, 63, -5)).side).toBe("ahead");
    // Turn the head to face west, and what was to the left is now ahead.
    expect(bearingOf(from, Math.PI / 2, new Vec3(-5, 63, 0))).toEqual({ side: "ahead", angle: 0 });
  });
});

describe("what the eyes deliver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
  });
  afterEach(() => void vi.useRealTimers());
  const mobOf = (d: MinecraftStateData, id: number) => d.nearby.mobs.find((m) => m.id === `entity:${id}`)!;

  it("bearing and seen are right ahead, to the side and behind", () => {
    const w = world();
    w.add(2, "cow", "animal", 0, -6);
    w.add(3, "cow", "animal", 6, -1);
    w.add(4, "cow", "animal", -4, 4);
    w.add(5, "cow", "animal", 0, 7);
    const d = w.data();
    expect(mobOf(d, 2)).toMatchObject({ bearing: { side: "ahead", angle: 0 }, seen: true });
    expect(mobOf(d, 3)).toMatchObject({ bearing: { side: "right" }, seen: true });
    // 135 degrees round to the left is outside the 110-degree field; straight behind certainly is.
    expect(mobOf(d, 4)).toMatchObject({ bearing: { side: "behind", angle: 135 }, seen: false });
    expect(mobOf(d, 5)).toMatchObject({ bearing: { side: "behind", angle: 180 }, seen: false });
  });

  it("a wall blocks sight", () => {
    const w = world({ walls: ["0,63,-3", "0,64,-3"] });
    w.add(2, "cow", "animal", 0, -6);
    expect(mobOf(w.data(), 2)).toMatchObject({ bearing: { side: "ahead" }, seen: false });
  });

  it("says what the head is pointed at", () => {
    const w = world();
    w.add(2, "cow", "animal", 0, -6);
    w.add(3, "cow", "animal", 6, 0);
    expect(w.data().self.gaze).toEqual({ id: "entity:2", yaw: 0 });
    w.me.yaw = -Math.PI / 2; // facing east
    expect(w.data().self.gaze).toEqual({ id: "entity:3", yaw: 270 });
  });

  it("closing is right for something approaching fast, slowly, and moving away", async () => {
    const w = world();
    w.add(2, "zombie", "hostile", 0, -20);
    w.add(3, "cow", "animal", 0, -15);
    w.add(4, "cow", "animal", 3, -6);
    await w.run(500);
    await w.run(1000, { 2: [0, 6], 3: [0, 1.5], 4: [0, -2] });
    const d = w.data();
    expect(mobOf(d, 2).closing).toBeCloseTo(6, 0);
    expect(mobOf(d, 3).closing).toBeCloseTo(1.5, 0);
    expect(mobOf(d, 4).closing).toBeLessThan(-1);
    // Only the fast one is looming.
    expect(d.nearby.sudden.filter((s) => s.what === "looming").map((s) => s.id)).toEqual(["entity:2"]);
  });

  it("the bot walking up to a still thing does not make it close in", async () => {
    const w = world();
    w.add(2, "cow", "animal", 0, -20);
    await w.run(500);
    for (let i = 0; i < 20; i++) {
      w.me.position = w.me.position.offset(0, 0, -0.3);
      await w.run(50);
    }
    expect(mobOf(w.data(), 2).closing).toBe(0);
  });

  it("reports a thing that just appeared, and one that just started moving, only while it is news and in view", async () => {
    const w = world();
    w.add(2, "cow", "animal", 0, -8);
    w.add(3, "cow", "animal", 0, 8); // behind
    await w.run(300);
    expect(w.data().nearby.sudden).toEqual([{ id: "entity:2", what: "appeared", bearing: { side: "ahead", angle: 0 }, dist: 8 }]);
    await w.run(1500);
    expect(w.data().nearby.sudden).toEqual([]);
    await w.run(300, { 2: [3, 0] });
    expect(w.data().nearby.sudden).toMatchObject([{ id: "entity:2", what: "started_moving" }]);
    await w.run(1500, { 2: [3, 0] });
    expect(w.data().nearby.sudden).toEqual([]);
  });

  it("a projectile heading this way is looming at once; one heading elsewhere is not", async () => {
    const w = world();
    await w.run(300);
    // The server's packet carries the real speed (blocks a tick); the entity's own is 8000 times too small.
    const arrow = w.add(9, "arrow", "projectile", 0, -16, 64.5);
    arrow.velocity = new Vec3(0, 0, 1.5 / 8000);
    w.packet("spawn_entity", { entityId: 9, velocity: { x: 0, y: 0, z: 1.5 } });
    w.add(10, "arrow", "projectile", 8, -16, 64.5);
    w.packet("spawn_entity", { entityId: 10, velocity: { x: 1.5, y: 0, z: 0 } });
    expect(w.data().nearby.sudden).toEqual([{ id: "entity:9", what: "looming", bearing: { side: "ahead", angle: 0 }, dist: 16 }]);
    expect(headingFor(new Vec3(0, 64, -16), { x: 0, y: 0, z: -1.5 }, new Vec3(0, 64, 0))).toBe(false);
  });

  it("a block placed or broken in view is a change", async () => {
    const w = world();
    const at = new Vec3(2, 63, -3);
    w.emit("blockUpdate", { name: "air", boundingBox: "empty", position: at, getProperties: () => ({}) }, { name: "stone", boundingBox: "block", position: at, getProperties: () => ({}) });
    expect(w.data().nearby.sudden).toMatchObject([{ id: "pos:2,63,-3", what: "changed", bearing: { side: "ahead" } }]);
  });
});

describe("what the ears deliver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
  });
  afterEach(() => void vi.useRealTimers());

  it("an explosion carries its position and bearing, and fades after 2 seconds", async () => {
    const w = world();
    w.packet("explosion", { center: { x: 0.5, y: 63, z: 9.5 } });
    expect(w.data().nearby.heard).toEqual([{ type: "explosion", bearing: { side: "behind", angle: 180 }, dist: 9, position: { x: 0, y: 63, z: 9 }, loudness: 0.9, msAgo: 0 }]);
    await w.run(2500);
    expect(w.data().nearby.heard).toEqual([]);
  });

  it("hears thunder, something hurt, a door, a shot and any other sound by where it came from, and not its own sounds", () => {
    const w = world();
    w.emit("entitySpawn", { id: 20, name: "lightning_bolt", type: "other", position: new Vec3(-20, 63, 0), velocity: new Vec3(0, 0, 0) });
    w.emit("entityHurt", { id: 21, position: new Vec3(5, 63, 0) });
    const door = (open: boolean) => ({ name: "oak_door", boundingBox: "block", position: new Vec3(0, 63, -4), getProperties: () => ({ open }) });
    w.emit("blockUpdate", door(false), door(true));
    w.packet("sound_effect", { x: 8 * 3, y: 8 * 63, z: 8 * 3, volume: 1 });
    w.packet("sound_effect", { x: 4, y: 8 * 63, z: 4, volume: 1 }); // at its own feet
    const heard = w.data().nearby.heard;
    expect(heard.map((h) => [h.type, h.bearing.side])).toEqual([["thunder", "left"], ["hurt", "right"], ["door", "ahead"], ["sound", "behind"]]);
    expect(heard[0]!.loudness).toBeGreaterThan(heard[1]!.loudness);
  });

  it("the stand-in for footsteps: a hostile within 8 blocks that is not seen is heard faintly, with its bearing", () => {
    const w = world();
    w.add(2, "zombie", "hostile", 0, 5); // behind
    w.add(3, "zombie", "hostile", 0, -5); // ahead, seen
    w.add(4, "zombie", "hostile", 0, 14); // behind, too far
    w.add(5, "cow", "animal", 3, 5); // behind, not hostile
    expect(w.data().nearby.heard).toEqual([{ type: "presence", bearing: { side: "behind", angle: 180 }, dist: 5, position: { x: 0, y: 63, z: 5 }, loudness: 0.2 }]);
  });
});
