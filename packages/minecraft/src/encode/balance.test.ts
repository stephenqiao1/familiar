import { describe, expect, it } from "vitest";
import { Vec3 } from "vec3";
import { setKnownSurfaces } from "../posture/surfaces.js";
import { balanceSense } from "./balance.js";
import type { EncodableBot } from "./encodable-bot.js";

const NOT_SOLID = new Set(["air", "water", "lava", "ladder", "vine"]);

/**
 * A small world: the listed blocks by "x,y,z", and `ground` everywhere at y <= `floor` (air
 * above). The bot's feet are at `at`; `air` puts it off the ground, moving at `vy` blocks a tick.
 */
function world(opts: { blocks?: Record<string, string>; floor?: number; at?: [number, number, number]; air?: boolean; vy?: number; level?: number } = {}): EncodableBot {
  const [x, y, z] = opts.at ?? [0, 64, 0];
  const nameAt = (p: Vec3) => opts.blocks?.[`${p.x},${p.y},${p.z}`] ?? (p.y <= (opts.floor ?? 63) ? "stone" : "air");
  return {
    entity: { id: 1, position: new Vec3(x + 0.5, y, z + 0.5), onGround: !opts.air, velocity: { x: 0, y: opts.vy ?? 0, z: 0 } },
    game: { dimension: "overworld", minY: 0 },
    blockAt(pos: Vec3) {
      const name = nameAt(pos.floored());
      return { name, boundingBox: NOT_SOLID.has(name) ? "empty" : "block", light: 0, skyLight: 15, getProperties: () => ({ level: opts.level ?? 0 }) };
    },
  } as unknown as EncodableBot;
}

/** A column of `name` from y=`from` to y=`to` at x,z. */
const column = (x: number, z: number, from: number, to: number, name: string) => Object.fromEntries(Array.from({ length: to - from + 1 }, (_, i) => [`${x},${from + i},${z}`, name]));

describe("balanceSense", () => {
  it("flat solid ground with room around: fully steady", () => {
    expect(balanceSense(world())).toEqual({ support: { on: "stone", kind: "solid", edges: 0, headroom: 3 }, velocity: { x: 0, y: 0, z: 0, onGround: true }, landing: null, balance: 1 });
  });

  it("a one-wide ledge: two sides fall away, and balance drops", () => {
    // A strip of stone along x at z=0, y=63, with nothing beside it for 10 blocks down.
    const blocks = Object.fromEntries([-2, -1, 0, 1, 2].map((x) => [`${x},63,0`, "stone"]));
    const sense = balanceSense(world({ blocks, floor: 50 }));
    expect(sense.support).toMatchObject({ on: "stone", kind: "solid", edges: 2 });
    expect(sense.balance).toBe(0.5);
    // A cliff top has one edge: less steady than open ground, steadier than the ledge.
    const cliff = balanceSense(world({ blocks: { ...column(0, 0, 51, 63, "stone"), ...column(1, 0, 51, 63, "stone"), ...column(0, 1, 51, 63, "stone"), ...column(0, -1, 51, 63, "stone") }, floor: 50 }));
    expect(cliff.support.edges).toBe(1);
    expect(cliff.balance).toBe(0.85);
  });

  it("sand over a cave: loose, for a bot that knows sand is", () => {
    const bot = world({ blocks: { "0,63,0": "sand", "0,62,0": "air", "0,61,0": "air" } });
    expect(balanceSense(bot)).toMatchObject({ support: { on: "sand", kind: "loose" }, balance: 0.7 });
    // A bot that has not learned it yet feels ordinary ground.
    setKnownSurfaces(bot, () => null);
    expect(balanceSense(bot)).toMatchObject({ support: { on: "sand", kind: "solid" }, balance: 1 });
  });

  it("learned slippery and slow surfaces lower balance; low headroom is reported", () => {
    const bot = world({ blocks: { "0,63,0": "ice", "0,66,0": "stone" } });
    setKnownSurfaces(bot, (name) => (name === "ice" ? "slippery" : null));
    expect(balanceSense(bot)).toMatchObject({ support: { on: "ice", kind: "slippery", headroom: 0 }, balance: 0.6 });
  });

  it("a ladder: climbing", () => {
    const sense = balanceSense(world({ blocks: { "0,64,0": "ladder" }, at: [0, 64, 0], air: true }));
    expect(sense.support).toMatchObject({ on: "ladder", kind: "climbing" });
    expect(sense.landing).toBeNull();
    expect(sense.balance).toBe(0.5);
  });

  it("water: liquid, and less steady when it flows", () => {
    expect(balanceSense(world({ blocks: { "0,64,0": "water" } }))).toMatchObject({ support: { on: "water", kind: "liquid" }, balance: 0.6 });
    expect(balanceSense(world({ blocks: { "0,64,0": "water" }, level: 3 })).balance).toBe(0.4);
  });

  it("mid-air over stone, 8 up: the landing would hurt and balance is 0", () => {
    const sense = balanceSense(world({ at: [0, 72, 0], air: true, vy: -0.5 }));
    expect(sense.support).toMatchObject({ on: "air", kind: "none" });
    expect(sense.velocity).toEqual({ x: 0, y: -10, z: 0, onGround: false });
    expect(sense.landing).toEqual({ blocks: 8, onto: "stone", hurts: true, steer: null });
    expect(sense.balance).toBe(0);
  });

  it("mid-air over water: the landing does not hurt", () => {
    const sense = balanceSense(world({ blocks: { "0,63,0": "water" }, at: [0, 72, 0], air: true }));
    expect(sense.landing).toEqual({ blocks: 8, onto: "water", hurts: false, steer: null });
    expect(sense.balance).toBe(0.4);
  });

  it("a short hop is not a fall, but a short drop after a long one is", () => {
    expect(balanceSense(world({ at: [0, 65, 0], air: true }))).toMatchObject({ landing: { blocks: 1, hurts: false }, balance: 0.9 });
    expect(balanceSense(world({ at: [0, 65, 0], air: true }), 6).landing).toMatchObject({ blocks: 1, hurts: true });
  });

  it("over the void, the landing is the void and it hurts", () => {
    const sense = balanceSense(world({ floor: -1, at: [0, 10, 0], air: true }));
    expect(sense.landing).toMatchObject({ onto: "void", hurts: true });
  });

  describe("a better landing", () => {
    it("water one block to the side is offered", () => {
      const sense = balanceSense(world({ blocks: { "1,63,0": "water" }, at: [0, 72, 0], air: true }));
      expect(sense.landing).toMatchObject({ hurts: true, steer: "pos:1,64,0" });
    });

    it("ground at least 3 higher is offered; ground 2 higher is not", () => {
      expect(balanceSense(world({ blocks: column(2, 0, 64, 68, "stone"), at: [0, 72, 0], air: true })).landing?.steer).toBe("pos:2,69,0");
      expect(balanceSense(world({ blocks: column(2, 0, 64, 65, "stone"), at: [0, 72, 0], air: true })).landing?.steer).toBeNull();
    });

    it("never lava, fire or anything known to hurt, even when it is the only thing in reach", () => {
      expect(balanceSense(world({ blocks: { "1,63,0": "lava" }, at: [0, 72, 0], air: true })).landing?.steer).toBeNull();
      expect(balanceSense(world({ blocks: { ...column(1, 0, 64, 68, "stone"), "1,69,0": "cactus" }, at: [0, 72, 0], air: true })).landing?.steer).toBeNull();
    });

    it("not through a wall", () => {
      const wall = { ...column(1, 0, 64, 80, "stone"), "2,63,0": "water" };
      expect(balanceSense(world({ blocks: wall, at: [0, 72, 0], air: true })).landing?.steer).toBeNull();
    });
  });
});
