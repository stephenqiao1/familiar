import { Vec3 } from "vec3";
import { describe, expect, it } from "vitest";
import { findCover, roofed, type CoverWorld } from "./cover.js";

/** A flat floor at y 63 with air above, plus the solid blocks named. */
function world(solid: [number, number, number][], at = new Vec3(0.5, 64, 0.5)): CoverWorld {
  const blocks = new Set(solid.map((b) => b.join(",")));
  return { entity: { position: at }, blockAt: (pos) => ({ boundingBox: pos.y === 63 || blocks.has(`${pos.x},${pos.y},${pos.z}`) ? "block" : "empty" }) };
}

describe("cover", () => {
  it("finds the nearest spot to stand with a roof overhead", () => {
    const bot = world([[5, 66, 0], [-8, 66, 0]]);
    expect(roofed(bot, new Vec3(0, 64, 0))).toBe(false);
    expect(findCover(bot)).toEqual(new Vec3(5, 64, 0));
  });

  it("is the bot's own spot when it is already under a roof, and nothing when there is no roof close by", () => {
    expect(findCover(world([[0, 67, 0]]))).toEqual(new Vec3(0, 64, 0));
    expect(findCover(world([]))).toBeNull();
    expect(findCover(world([[30, 66, 0]]))).toBeNull();
  });

  it("a roof too high above the head is not cover", () => {
    expect(findCover(world([[3, 72, 0]]))).toBeNull();
  });
});
