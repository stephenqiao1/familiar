import type { Bot } from "mineflayer";
import type { Vec3 } from "vec3";

/**
 * The nearest block matching `test` within `radius` of `point` (default: the bot), or null.
 * mineflayer walks chunk sections in a diamond and stops early, so a plain search can skip
 * sections inside the radius or return a block that isn't the closest. Search twice as far for
 * several hits, then pick the closest one within the radius.
 */
export function findBlockNear(bot: Bot, test: (name: string) => boolean, radius: number, point?: Vec3): Vec3 | null {
  const from = point ?? bot.entity.position;
  const hits = bot.findBlocks({ point: from, matching: (b) => test(b.name), maxDistance: radius * 2, count: 64 });
  let best: Vec3 | null = null;
  for (const hit of hits) {
    const d = hit.distanceTo(from);
    if (d <= radius && (best === null || d < best.distanceTo(from))) best = hit;
  }
  return best;
}
