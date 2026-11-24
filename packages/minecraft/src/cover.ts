import { Vec3 } from "vec3";

// Cover: somewhere to stand with a roof overhead, for getting out from under something coming
// down from above. Plain block checks; no pathfinding here.

/** Cover is looked for this far out and this far up and down; a roof counts within this many blocks above the head. */
export const COVER = { within: 10, upDown: 2, roofWithin: 4 };

/** The blocks cover is judged from. A real bot satisfies this. */
export interface CoverWorld {
  entity: { position: Vec3 };
  blockAt(pos: Vec3): { boundingBox: string } | null;
}

const solid = (bot: CoverWorld, at: Vec3) => bot.blockAt(at)?.boundingBox === "block";
const open = (bot: CoverWorld, at: Vec3) => bot.blockAt(at)?.boundingBox === "empty";

/** Whether the spot whose feet are at `feet` is under a roof: a solid block within reach above the head. */
export function roofed(bot: CoverWorld, feet: Vec3): boolean {
  for (let up = 2; up < 2 + COVER.roofWithin; up++) if (solid(bot, feet.offset(0, up, 0))) return true;
  return false;
}

/** Whether a body can stand with its feet at `feet`: floor below, room for feet and head. */
function standable(bot: CoverWorld, feet: Vec3): boolean {
  return solid(bot, feet.offset(0, -1, 0)) && open(bot, feet) && open(bot, feet.offset(0, 1, 0));
}

/** The nearest spot to stand under a roof (the bot's own spot if it is already under one), or null if there is none close by. */
export function findCover(bot: CoverWorld): Vec3 | null {
  const here = bot.entity.position.floored();
  if (roofed(bot, here)) return here;
  let best: { at: Vec3; dist: number } | null = null;
  for (let dx = -COVER.within; dx <= COVER.within; dx++) {
    for (let dz = -COVER.within; dz <= COVER.within; dz++) {
      for (let dy = -COVER.upDown; dy <= COVER.upDown; dy++) {
        const dist = Math.hypot(dx, dy, dz);
        if (dist > COVER.within || (best && dist >= best.dist)) continue;
        const at = here.offset(dx, dy, dz);
        if (standable(bot, at) && roofed(bot, at)) best = { at, dist };
      }
    }
  }
  return best?.at ?? null;
}
