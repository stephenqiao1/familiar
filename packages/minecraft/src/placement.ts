import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import type { Block } from "./mc-types.js";

// Where a block could be placed. Finding the spot only looks; placing is done by the place_block primitive.

/**
 * An air spot 2–3 blocks from the bot, on solid ground at its feet level. A bed's head goes one block
 * further away from the bot (the way it faces when placing), so that block must be clear too.
 */
export function findPlacementSpot(bot: Bot, needsHead: boolean): { target: Vec3; floor: Block } | null {
  const feet = bot.entity.position.floored();
  for (const offset of placementOffsets(needsHead)) {
    const target = feet.plus(offset);
    const floor = bot.blockAt(target.offset(0, -1, 0));
    if (!floor || floor.boundingBox !== "block" || !isEmpty(bot, target)) continue;
    if (needsHead) {
      const head = target.plus(facing(offset));
      if (!isEmpty(bot, head) || !isSolid(bot, head.offset(0, -1, 0))) continue;
    }
    return { target, floor };
  }
  return null;
}

/** Offsets 2–3 blocks out, nearest first. Beds skip exact diagonals so the facing is unambiguous. */
function placementOffsets(skipDiagonals: boolean): Vec3[] {
  const offsets: Vec3[] = [];
  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) < 2) continue;
      if (skipDiagonals && Math.abs(dx) === Math.abs(dz)) continue;
      offsets.push(new Vec3(dx, 0, dz));
    }
  }
  return offsets.sort((a, b) => a.x * a.x + a.z * a.z - (b.x * b.x + b.z * b.z));
}

/** The cardinal direction the bot faces when looking at `offset`. */
function facing(offset: Vec3): Vec3 {
  return Math.abs(offset.x) > Math.abs(offset.z)
    ? new Vec3(Math.sign(offset.x), 0, 0)
    : new Vec3(0, 0, Math.sign(offset.z));
}

function isEmpty(bot: Bot, pos: Vec3): boolean {
  const name = bot.blockAt(pos)?.name;
  return name === "air" || name === "cave_air";
}

function isSolid(bot: Bot, pos: Vec3): boolean {
  return bot.blockAt(pos)?.boundingBox === "block";
}
