import { Vec3 } from "vec3";
import type { EncodableBot } from "./encodable-bot.js";

/**
 * Positions of blocks whose name passes `test`, within `radius` of the bot, nearest first.
 * Reads raw block-state ids over the sphere: exact, and several times faster than findBlocks
 * (which also skips some chunk sections inside the radius).
 */
export function scanBlocks(bot: EncodableBot, test: (name: string) => boolean, radius: number, limit: number): Vec3[] {
  const states = new Set<number>();
  for (const block of bot.registry.blocksArray) {
    if (test(block.name)) for (let s = block.minStateId; s <= block.maxStateId; s++) states.add(s);
  }
  if (states.size === 0) return [];

  const me = bot.entity.position;
  const feet = me.floored();
  const cursor = new Vec3(0, 0, 0);
  const hits: { pos: Vec3; d: number }[] = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        cursor.set(feet.x + dx, feet.y + dy, feet.z + dz);
        const state = bot.world.getBlockStateId(cursor);
        if (state === undefined || !states.has(state)) continue;
        const d = cursor.distanceTo(me);
        if (d <= radius) hits.push({ pos: cursor.clone(), d });
      }
    }
  }
  return hits
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map((hit) => hit.pos);
}

export function posId(pos: Vec3): string {
  return `pos:${pos.x},${pos.y},${pos.z}`;
}
