import { isHostile } from "../mobs.js";
import type { EncodableBot } from "./encodable-bot.js";
import type { Nearby } from "./state-data.js";

const RADIUS = 24;
/** How many of a kind of nearby thing the state keeps, unless told otherwise. */
export const DEFAULT_LIMIT = 10;
const MOB_TYPES = new Set(["mob", "hostile", "animal", "passive", "ambient", "water_creature"]);

/** The nearest mobs (up to `limit`) within 24 blocks. Players, items and projectiles are not mobs. */
export function scanMobs(bot: EncodableBot, limit = DEFAULT_LIMIT): (Nearby & { hostile: boolean })[] {
  const me = bot.entity.position;
  return Object.values(bot.entities)
    .filter((e) => e.id !== bot.entity.id && MOB_TYPES.has(e.type))
    .map((e) => ({ e, d: e.position.distanceTo(me) }))
    .filter((m) => m.d <= RADIUS)
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map(({ e, d }) => ({ id: `entity:${e.id}`, type: e.name ?? "unknown", dist: Math.round(d), hostile: isHostile(e) }));
}

/** The nearest other players (up to `limit`) within 24 blocks. */
export function scanPlayers(bot: EncodableBot, limit = DEFAULT_LIMIT): Nearby[] {
  const me = bot.entity.position;
  return Object.values(bot.entities)
    .filter((e) => e.id !== bot.entity.id && e.type === "player")
    .map((e) => ({ id: `entity:${e.id}`, type: "player", dist: Math.round(e.position.distanceTo(me)) }))
    .filter((p) => p.dist <= RADIUS)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit);
}
