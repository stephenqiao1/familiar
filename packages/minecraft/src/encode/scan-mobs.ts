import type { Vec3 } from "vec3";
import { isHostile } from "../mobs.js";
import type { EncodableBot } from "./encodable-bot.js";
import type { Nearby } from "./state-data.js";

const RADIUS = 24;
/** How many of a kind of nearby thing the state keeps, unless told otherwise. */
export const DEFAULT_LIMIT = 10;
/** A mob more than this far above or below the bot cannot simply walk up to it. */
const MAX_HEIGHT_GAP = 3;
const EYE_HEIGHT = 1.6;
const MOB_TYPES = new Set(["mob", "hostile", "animal", "passive", "ambient", "water_creature"]);

/** The nearest mobs (up to `limit`) within 24 blocks. Players, items and projectiles are not mobs. */
export function scanMobs(bot: EncodableBot, limit = DEFAULT_LIMIT): (Nearby & { hostile: boolean; reachable: boolean })[] {
  const me = bot.entity.position;
  return Object.values(bot.entities)
    .filter((e) => e.id !== bot.entity.id && MOB_TYPES.has(e.type))
    .map((e) => ({ e, d: e.position.distanceTo(me) }))
    .filter((m) => m.d <= RADIUS)
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map(({ e, d }) => {
      const hostile = isHostile(e);
      // Only checked for hostile mobs: it costs a ray through the world each.
      return { id: `entity:${e.id}`, type: e.name ?? "unknown", dist: Math.round(d), hostile, reachable: !hostile || isReachable(bot, e.position, e.height ?? EYE_HEIGHT) };
    });
}

/**
 * A cheap stand-in for "this mob can get to me": it is within 3 blocks of the bot's height and no
 * solid block sits between its eyes and the bot's. A mob across a pit at the same height still
 * counts as reachable; real pathfinding per mob would be too slow to run every tick.
 */
function isReachable(bot: EncodableBot, position: Vec3, height: number): boolean {
  const me = bot.entity.position;
  if (Math.abs(position.y - me.y) > MAX_HEIGHT_GAP) return false;
  if (!bot.world.raycast) return true;
  const from = me.offset(0, EYE_HEIGHT, 0);
  const to = position.offset(0, height * 0.9, 0);
  const distance = from.distanceTo(to);
  if (distance === 0) return true;
  return bot.world.raycast(from, to.minus(from).scaled(1 / distance), distance, (block) => block.boundingBox === "block") === null;
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
