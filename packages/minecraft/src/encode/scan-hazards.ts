import { Vec3 } from "vec3";
import type { EncodableBot } from "./encodable-bot.js";
import { posId, scanBlocks } from "./scan-blocks.js";
import type { Nearby } from "./state-data.js";

const RADIUS = 8;
const LIMIT = 10;
const BIG_DROP = 3;
const FIRE = new Set(["lava", "fire", "soul_fire"]);

/** Lava, fire, and drops of 3+ blocks within 8 blocks, nearest 10. */
export function scanHazards(bot: EncodableBot): Nearby[] {
  const me = bot.entity.position;
  const blocks = scanBlocks(bot, (name) => FIRE.has(name), RADIUS, LIMIT).map((pos) => ({
    pos,
    type: bot.blockAt(pos)?.name === "lava" ? "lava" : "fire",
  }));
  const hazards = [...blocks, ...drops(bot).map((pos) => ({ pos, type: "drop" }))];
  return hazards
    .map((h) => ({ id: posId(h.pos), type: h.type, dist: Math.round(h.pos.distanceTo(me)) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, LIMIT);
}

/**
 * Spots at the bot's feet level that open onto a fall of 3+ blocks (an edge it could walk off).
 * Water breaks a fall, so it doesn't count as empty.
 */
function drops(bot: EncodableBot): Vec3[] {
  const feet = bot.entity.position.floored();
  const found: Vec3[] = [];
  for (let dx = -RADIUS; dx <= RADIUS; dx++) {
    for (let dz = -RADIUS; dz <= RADIUS; dz++) {
      if (dx * dx + dz * dz > RADIUS * RADIUS) continue;
      const spot = new Vec3(feet.x + dx, feet.y, feet.z + dz);
      if (!isOpen(bot, spot)) continue;
      let depth = 0;
      while (depth < BIG_DROP && isOpen(bot, spot.offset(0, -1 - depth, 0))) depth++;
      if (depth >= BIG_DROP) found.push(spot);
    }
  }
  return found;
}

function isOpen(bot: EncodableBot, pos: Vec3): boolean {
  const block = bot.blockAt(pos);
  return block !== null && block.boundingBox === "empty" && block.name !== "water" && block.name !== "lava";
}
