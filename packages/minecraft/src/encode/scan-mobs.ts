import { isHostile } from "../mobs.js";
import type { EncodableBot } from "./encodable-bot.js";
import type { Nearby } from "./state-data.js";

const RADIUS = 24;
const LIMIT = 10;
const MOB_TYPES = new Set(["mob", "hostile", "animal", "passive", "ambient", "water_creature"]);

/** Up to 10 nearest mobs within 24 blocks. Players, items and projectiles are not mobs. */
export function scanMobs(bot: EncodableBot): (Nearby & { hostile: boolean })[] {
  const me = bot.entity.position;
  return Object.values(bot.entities)
    .filter((e) => e.id !== bot.entity.id && MOB_TYPES.has(e.type))
    .map((e) => ({ e, d: e.position.distanceTo(me) }))
    .filter((m) => m.d <= RADIUS)
    .sort((a, b) => a.d - b.d)
    .slice(0, LIMIT)
    .map(({ e, d }) => ({ id: `entity:${e.id}`, type: e.name ?? "unknown", dist: Math.round(d), hostile: isHostile(e) }));
}
