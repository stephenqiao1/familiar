import { Vec3 } from "vec3";
import { describe, expect, it } from "vitest";
import { headInBlock } from "./touching.js";

/** A bot whose eyes are at x within a block of the given kind and solid parts. */
const bot = (x: number, block: { boundingBox: string; shapes?: number[][] } | null) => ({ entity: { position: new Vec3(x, 64, 0.5) }, blockAt: () => block }) as never;
/** An open door: a thin slab along one side of its block. */
const OPEN_DOOR = { boundingBox: "block", shapes: [[0, 0, 0, 0.1875, 1, 1]] };

describe("headInBlock", () => {
  it("is true inside a whole solid block and false in air", () => {
    expect(headInBlock(bot(0.5, { boundingBox: "block", shapes: [[0, 0, 0, 1, 1, 1]] }))).toBe(true);
    expect(headInBlock(bot(0.5, { boundingBox: "empty", shapes: [] }))).toBe(false);
    expect(headInBlock(bot(0.5, null))).toBe(false);
  });

  it("is false in an open doorway, and true only in the door's own slab", () => {
    expect(headInBlock(bot(0.5, OPEN_DOOR))).toBe(false);
    expect(headInBlock(bot(0.1, OPEN_DOOR))).toBe(true);
  });

  it("goes by the kind of block when its solid parts are not known", () => {
    expect(headInBlock(bot(0.5, { boundingBox: "block" }))).toBe(true);
  });
});
