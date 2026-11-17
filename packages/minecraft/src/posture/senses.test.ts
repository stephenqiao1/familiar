import { EventEmitter } from "node:events";
import type { Bot } from "mineflayer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Vec3 } from "vec3";
import { trackDisplaced } from "./displaced.js";
import { trackFalls } from "./falls.js";
import { feelSurfaces, paceVerdict, sawComeDown, setSurfaceLearner } from "./learn.js";
import { installPosture, type Fall } from "./runtime.js";
import { createSurfaces } from "./surfaces.js";

/** A body that can be put anywhere, tick by tick, on stone (or `ground`) at y <= 62. */
function body(ground = "stone") {
  const events = new EventEmitter();
  const keys = new Set<string>();
  const state = {
    entity: { position: new Vec3(0.5, 63, 0.5), onGround: true, isInWater: false, yaw: 0, effects: {} },
    health: 20,
    game: { dimension: "overworld" },
    players: {} as Record<string, { entity: { position: Vec3 } }>,
    on: (name: string, fn: (...args: unknown[]) => void) => events.on(name, fn),
    blockAt: (p: Vec3) => ({ name: p.y < 63 ? ground : "air", boundingBox: p.y < 63 ? "block" : "empty" }),
    getControlState: (k: string) => keys.has(k),
  };
  const tick = (x: number, y: number, z: number, onGround = true) => {
    state.entity.position = new Vec3(x, y, z);
    state.entity.onGround = onGround;
    events.emit("physicsTick");
  };
  return { bot: state as unknown as Bot, state, keys, tick, emit: (name: string) => events.emit(name) };
}

describe("trackFalls", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it("notes a fall on landing: how far, what it cost, and where the bot left the ground", async () => {
    const b = body();
    const falls: [Fall, Vec3 | null][] = [];
    const sense = trackFalls(b.bot, (fall, edge) => falls.push([fall, edge]));
    b.tick(0.5, 71, 0.5);
    b.tick(1.2, 71, 0.5, false);
    b.tick(1.5, 67, 0.5, false);
    expect(sense.fallen()).toBe(4);
    b.tick(1.5, 63, 0.5);
    b.state.health = 15;
    await vi.advanceTimersByTimeAsync(400);
    expect(falls).toHaveLength(1);
    expect(falls[0]![0]).toEqual({ blocks: 8, damage: 5, steered: false, onto: "stone", note: "no better landing in reach: nothing to do" });
    expect(falls[0]![1]).toEqual(new Vec3(0.5, 71, 0.5));
    expect(sense.fallen()).toBe(0);
  });

  it("does not call a jump or a step down a fall", async () => {
    const b = body();
    const falls: Fall[] = [];
    trackFalls(b.bot, (fall) => falls.push(fall));
    b.tick(0.5, 63, 0.5);
    b.tick(0.5, 64.2, 0.5, false);
    b.tick(0.5, 63, 0.5);
    await vi.advanceTimersByTimeAsync(400);
    expect(falls).toEqual([]);
  });

  it("a body moved somewhere else mid-air is not falling from where it was", async () => {
    const b = body();
    const falls: Fall[] = [];
    trackFalls(b.bot, (fall) => falls.push(fall));
    b.tick(0.5, 100, 0.5, false);
    b.emit("forcedMove");
    b.tick(0.5, 63, 0.5);
    await vi.advanceTimersByTimeAsync(400);
    expect(falls).toEqual([]);
  });
});

describe("trackDisplaced", () => {
  it("notices a jump of more than 8 blocks in one tick, once, and not ordinary movement", () => {
    const b = body();
    const moves: [Vec3, Vec3][] = [];
    const sense = trackDisplaced(b.bot, (from, to) => moves.push([from, to]));
    b.tick(0.5, 63, 0.5);
    b.tick(1.1, 63, 0.5);
    expect(sense.take()).toBe(false);
    b.tick(50.5, 63, 0.5);
    expect(moves).toEqual([[new Vec3(1.1, 63, 0.5), new Vec3(50.5, 63, 0.5)]]);
    expect(sense.take()).toBe(true);
    expect(sense.take()).toBe(false);
    b.tick(50.9, 63, 0.5);
    expect(sense.take()).toBe(false);
  });

  it("notices a change of dimension even at the same coordinates", () => {
    const b = body();
    const sense = trackDisplaced(b.bot);
    b.tick(0.5, 63, 0.5);
    b.state.game.dimension = "the_nether";
    b.tick(0.5, 63, 0.5);
    expect(sense.take()).toBe(true);
  });
});

describe("learning that a block is loose", () => {
  const setup = (innateLoose: string[] = []) => {
    const b = body();
    const logged: string[] = [];
    const posture = installPosture(b.bot, { check: 1, stance: 1 }, (msg) => logged.push(msg));
    const surfaces = createSurfaces({ innateLoose });
    let quiet = true;
    setSurfaceLearner(b.bot, surfaces, () => quiet);
    return { ...b, logged, posture, surfaces, setQuiet: (on: boolean) => void (quiet = on) };
  };

  it("two digs where the block above came down make it known loose; one does not; nothing is known at the start", () => {
    const t = setup();
    expect(t.surfaces.kindOf("sand")).toBeNull();
    sawComeDown(t.bot, "sand", undefined, 0);
    expect(t.surfaces.kindOf("sand")).toBeNull();
    sawComeDown(t.bot, "sand", undefined, 10_000);
    expect(t.surfaces.kindOf("sand")).toBe("loose");
    expect(t.logged.at(-1)).toBe("posture: learned that sand is loose (came down when dug under, 2 times)");
    expect(t.posture.take().learned).toEqual(["sand is loose"]);
  });

  it("counts only a block that really fell: it must be found where the dug block was, or just below, a moment later", async () => {
    vi.useFakeTimers();
    const t = setup();
    // The body's world has stone below y=63 and air above: nothing called sand has landed anywhere.
    sawComeDown(t.bot, "cactus", new Vec3(0, 64, 0), 0);
    await vi.advanceTimersByTimeAsync(800);
    expect(t.surfaces.entries().loose).toEqual({});
    // "stone" is found two below where it was dug under.
    sawComeDown(t.bot, "stone", new Vec3(0, 64, 0), 0);
    await vi.advanceTimersByTimeAsync(800);
    expect(t.surfaces.entries().loose).toEqual({ stone: 1 });
    vi.useRealTimers();
  });

  it("learns nothing when another player is close or there was an explosion just now", () => {
    const t = setup();
    t.state.players.Steve = { entity: { position: new Vec3(3, 63, 0) } };
    sawComeDown(t.bot, "sand", undefined, 0);
    sawComeDown(t.bot, "sand", undefined, 10_000);
    delete t.state.players.Steve;
    t.setQuiet(false);
    sawComeDown(t.bot, "sand", undefined, 20_000);
    expect(t.surfaces.entries().loose).toEqual({});
    expect(t.logged.at(-1)).toContain("nothing learned");
  });
});

describe("feeling how a surface behaves", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => void vi.useRealTimers());

  it("judges a pace against what the legs should manage", () => {
    expect([paceVerdict(4.3, false), paceVerdict(1.7, false), paceVerdict(7, false), paceVerdict(5.6, true), paceVerdict(2.2, true), paceVerdict(3.9, false)]).toEqual([null, "slow", "slippery", null, "slow", null]);
    // Sprinting for part of the stretch: what the legs should manage lies in between. Ice measured live: 4.0 at 67% is not clearly slow.
    expect([paceVerdict(4.0, 0.67), paceVerdict(2.5, 0.5)]).toEqual([null, "slow"]);
  });

  /** Walks north at `speed` blocks a second for `ms`, holding forward, starting at z. */
  async function walk(b: ReturnType<typeof body>, z: number, speed: number, ms: number): Promise<number> {
    for (let t = 0; t < ms; t += 50) {
      z -= speed / 20;
      b.tick(0.5, 63, z);
      await vi.advanceTimersByTimeAsync(50);
    }
    return z;
  }

  it("learns a surface is slow from several stretches walked clearly under pace, and nothing from a normal pace", async () => {
    const b = body("soul_sand");
    const surfaces = createSurfaces({ innateLoose: [] });
    setSurfaceLearner(b.bot, surfaces);
    feelSurfaces(b.bot, () => true);
    b.keys.add("forward");
    let z = 0.5;
    z = await walk(b, z, 1.8, 8000);
    expect(surfaces.kindOf("soul_sand")).toBe("slow");

    const stone = body();
    const known = createSurfaces({ innateLoose: [] });
    setSurfaceLearner(stone.bot, known);
    feelSurfaces(stone.bot, () => true);
    stone.keys.add("forward");
    await walk(stone, 0.5, 4.3, 8000);
    expect(known.entries()).toEqual({ loose: {}, slippery: {}, slow: {} });
  });

  it("learns a surface is slippery from sliding on after the legs stop, several times", async () => {
    const b = body("ice");
    const surfaces = createSurfaces({ innateLoose: [] });
    setSurfaceLearner(b.bot, surfaces);
    feelSurfaces(b.bot, () => false);
    let z = 0.5;
    for (let i = 0; i < 3; i++) {
      b.keys.add("forward");
      z = await walk(b, z, 4.2, 300);
      b.keys.delete("forward");
      // Still sliding at walking pace for most of a second.
      z = await walk(b, z, 3, 700);
      await vi.advanceTimersByTimeAsync(3000);
    }
    expect(surfaces.kindOf("ice")).toBe("slippery");
  });

  it("does not measure a pace while turning, jumping or sneaking", async () => {
    const b = body("soul_sand");
    const surfaces = createSurfaces({ innateLoose: [] });
    setSurfaceLearner(b.bot, surfaces);
    feelSurfaces(b.bot, () => true);
    b.keys.add("forward");
    b.keys.add("sneak");
    await walk(b, 0.5, 1.3, 8000);
    expect(surfaces.entries().slow).toEqual({});
  });
});
