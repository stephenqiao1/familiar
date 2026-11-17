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

/** What a bot is born knowing hurts, unless its settings say otherwise. */
export const INNATE_HURTS = ["lava", "fire", "soul_fire", "magma_block", "cactus"];
const BORN_KNOWING = new Set(INNATE_HURTS);
/** Each bot's own knowledge of what hurts (innate and learned), given by `setKnownHurts`. */
const known = new WeakMap<object, (name: string) => boolean>();

/**
 * Tells the safety checks what this bot knows to hurt. From then on standing checks, pathing and
 * the reflexes all respect it for that bot. (This file only looks things up; it reads no files.)
 */
export function setKnownHurts(bot: object, knows: (name: string) => boolean): void {
  known.set(bot, knows);
}
const LIQUIDS = new Set(["lava", "water"]);
const SAFE_DROP = 3;
const SIDES: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// Whether a dig, a placement or a step is safe is asked in one place: posture/check.ts.

/** Whether a block hurts to touch or stand in, as far as this bot knows (a bot never told otherwise knows the innate five). */
export function isDangerousBlock(name: string, bot?: object): boolean {
  const knows = bot && known.get(bot);
  return knows ? knows(name) : BORN_KNOWING.has(name);
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
  if (!ground || ground.boundingBox !== "block" || isDangerousBlock(ground.name, bot)) return false;
  return [feet, feet.offset(0, 1, 0)].every((pos) => {
    const block = bot.blockAt(pos);
    return block !== null && block.boundingBox === "empty" && !isDangerousBlock(block.name, bot) && !LIQUIDS.has(block.name);
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

const AROUND: [number, number, number][] = [
  [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1],
];

/** Standing at `feet`, the bot would be touching a block it knows hurts: under it, in it, or beside it. */
export function touchesHurt(bot: WorldView, feet: Vec3): boolean {
  const hurts = (pos: Vec3) => isDangerousBlock(bot.blockAt(pos)?.name ?? "", bot);
  return hurts(feet.offset(0, -1, 0)) || hurts(feet) || hurts(feet.offset(0, 1, 0)) || AROUND.some(([x, y, z]) => hurts(feet.offset(x, y, z)));
}

/** A drop of `SAFE_DROP` or more lies straight below `pos` (water breaks a fall, so it does not count). */
export function isDropAt(bot: WorldView, pos: Vec3): boolean {
  for (let d = 0; d <= SAFE_DROP; d++) {
    const block = bot.blockAt(pos.offset(0, -d, 0));
    if (!block || block.boundingBox !== "empty" || LIQUIDS.has(block.name)) return d > SAFE_DROP;
  }
  return true;
}

/** `feet` is at the edge of a big drop: one of the four blocks beside it falls away. */
export function atEdge(bot: WorldView, feet: Vec3): boolean {
  return SIDES.some(([x, z]) => isDropAt(bot, feet.offset(x, 0, z)));
}

/**
 * What is dangerous at one block along a path: "drop" where the ground falls away, else the name
 * of a block there that the bot knows hurts (in it, or under it), else null.
 */
export function dangerAt(bot: WorldView, feet: Vec3): string | null {
  for (const pos of [feet, feet.offset(0, 1, 0), feet.offset(0, -1, 0)]) {
    const name = bot.blockAt(pos)?.name ?? "";
    if (isDangerousBlock(name, bot)) return name;
  }
  return isDropAt(bot, feet) ? "drop" : null;
}
