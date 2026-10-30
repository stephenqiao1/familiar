import type { Bot } from "mineflayer";
import { describe, expect, expectTypeOf, it } from "vitest";
import { Vec3 } from "vec3";
import { isDangerousBlock, isSafeToDig, type WorldView } from "./safety.js";

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

describe("isSafeToDig", () => {
  it("allows a plain block beside the bot", () => {
    const world = fakeWorld({ "1,0,0": "stone" }, [0, 0, 0]);
    expect(isSafeToDig(world, at(1, 0, 0))).toBe(true);
  });

  it.each(["lava", "water"])("refuses a block touching %s", (liquid) => {
    const world = fakeWorld({ "5,0,0": "stone", "5,1,0": liquid }, [0, 0, 0]);
    expect(isSafeToDig(world, at(5, 0, 0))).toBe(false);
  });

  it("allows digging the block underfoot when the drop is short", () => {
    // Bot stands at y=2 on a block at y=1, with one empty block below it and stone at y=-1.
    const world = fakeWorld({ "0,1,0": "dirt" }, [0, 2, 0]);
    expect(isSafeToDig(world, at(0, 1, 0))).toBe(true);
  });

  it("refuses digging the block underfoot over a drop of 3 or more", () => {
    // Bot stands at y=5 on a block at y=4; y=3, y=2 ... are empty down to stone below y=0.
    const world = fakeWorld({ "0,4,0": "dirt" }, [0, 5, 0]);
    expect(isSafeToDig(world, at(0, 4, 0))).toBe(false);
  });

  it("ignores drops under blocks the bot isn't standing on", () => {
    const world = fakeWorld({ "3,4,0": "dirt" }, [0, 5, 0]);
    expect(isSafeToDig(world, at(3, 4, 0))).toBe(true);
  });

  it("is satisfied by a real mineflayer Bot", () => {
    expectTypeOf<Bot>().toExtend<WorldView>();
  });
});
