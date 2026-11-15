import type { Vec3 } from "vec3";

/** The parts of a block the safety checks read. */
interface BlockLike {
  name: string;
  boundingBox: string;
}

/** The parts of a mineflayer Bot the safety checks read. A real Bot satisfies this. */
export interface WorldView {
  entity: { position: Vec3 };
  blockAt(pos: Vec3): BlockLike | null;
}

const DANGEROUS = new Set(["lava", "fire", "soul_fire", "magma_block", "cactus"]);
const LIQUIDS = new Set(["lava", "water"]);
const SAFE_DROP = 3;
const NEIGHBOURS: [number, number, number][] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

/** Blocks that hurt to touch or stand in. */
export function isDangerousBlock(name: string): boolean {
  return DANGEROUS.has(name);
}

/**
 * False if lava or water touches the block (it would flow in), or if the bot stands on it and
 * removing it would drop the bot 3 or more blocks.
 */
export function isSafeToDig(bot: WorldView, block: { position: Vec3 }): boolean {
  const pos = block.position;
  const touchesLiquid = NEIGHBOURS.some(([x, y, z]) => {
    const n = bot.blockAt(pos.offset(x, y, z));
    return n !== null && LIQUIDS.has(n.name);
  });
  if (touchesLiquid) return false;

  const underFeet = bot.entity.position.floored().offset(0, -1, 0);
  return !pos.equals(underFeet) || fallDepth(bot, pos) < SAFE_DROP;
}

/** How far the bot falls if `pos` and everything passable below it is empty. Unknown blocks count as a fall. */
function fallDepth(bot: WorldView, pos: Vec3): number {
  let depth = 1;
  while (depth < SAFE_DROP) {
    const below = bot.blockAt(pos.offset(0, -depth, 0));
    if (below && below.boundingBox === "block") break;
    depth++;
  }
  return depth;
}

const HOT = new Set(["lava", "fire", "soul_fire"]);

/** The bot's feet or head are in lava or fire. */
export function inLavaOrFire(bot: WorldView): boolean {
  const feet = bot.entity.position.floored();
  return [feet, feet.offset(0, 1, 0)].some((pos) => HOT.has(bot.blockAt(pos)?.name ?? ""));
}

/** Somewhere to stand: solid, harmless ground with two empty, harmless blocks above it. */
export function isSafeToStand(bot: WorldView, feet: Vec3): boolean {
  const ground = bot.blockAt(feet.offset(0, -1, 0));
  if (!ground || ground.boundingBox !== "block" || isDangerousBlock(ground.name)) return false;
  return [feet, feet.offset(0, 1, 0)].every((pos) => {
    const block = bot.blockAt(pos);
    return block !== null && block.boundingBox === "empty" && !isDangerousBlock(block.name) && !LIQUIDS.has(block.name);
  });
}

/** The nearest spot within `radius` (of the bot's feet) that `test` accepts, or null. */
export function nearestSpot(bot: WorldView, radius: number, test: (pos: Vec3) => boolean): Vec3 | null {
  const feet = bot.entity.position.floored();
  let best: Vec3 | null = null;
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const pos = feet.offset(dx, dy, dz);
        if ((best === null || pos.distanceTo(feet) < best.distanceTo(feet)) && test(pos)) best = pos;
      }
    }
  }
  return best;
}
