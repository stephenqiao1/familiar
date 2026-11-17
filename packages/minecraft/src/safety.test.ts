import type { Bot } from "mineflayer";
import { describe, expect, expectTypeOf, it } from "vitest";
import { Vec3 } from "vec3";
import { isDangerousBlock, type WorldView } from "./safety.js";

/** A tiny world: listed blocks by "x,y,z", stone everywhere below y=0, air elsewhere. */
function fakeWorld(blocks: Record<string, string>, botAt: [number, number, number]): WorldView {
  return {
    entity: { position: new Vec3(botAt[0] + 0.5, botAt[1], botAt[2] + 0.5) },
    blockAt(pos) {
      const name = blocks[`${pos.x},${pos.y},${pos.z}`] ?? (pos.y < 0 ? "stone" : "air");
      const solid = !["air", "water", "lava"].includes(name);
      return { name, boundingBox: solid ? "block" : "empty" };
    },
  };
}

const at = (x: number, y: number, z: number) => ({ position: new Vec3(x, y, z) });

describe("isDangerousBlock", () => {
  it.each(["lava", "fire", "soul_fire", "magma_block", "cactus"])("flags %s", (name) => {
    expect(isDangerousBlock(name)).toBe(true);
  });

  it.each(["stone", "water", "air", "iron_ore"])("allows %s", (name) => {
    expect(isDangerousBlock(name)).toBe(false);
  });
});

describe("WorldView", () => {
  it("is satisfied by a real mineflayer Bot", () => {
    expectTypeOf<Bot>().toExtend<WorldView>();
  });
});
