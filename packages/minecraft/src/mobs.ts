import type { Bot } from "mineflayer";
import type { Entity } from "./mc-types.js";
import { resolveTarget } from "./resolve-target.js";
import { parseTarget } from "./target.js";

/** Hostile mobs that minecraft-data files under the generic "mob" type. */
const ALSO_HOSTILE = new Set(["slime", "magma_cube", "ghast", "phantom", "shulker", "ender_dragon"]);

export function isHostile(entity: { type: string; name?: string | undefined }): boolean {
  return entity.type === "hostile" || ALSO_HOSTILE.has(entity.name ?? "");
}

/** The closest hostile mob within `maxDistance`, or null. */
export function nearestHostile(bot: Bot, maxDistance: number): Entity | null {
  const me = bot.entity.position;
  const mob = bot.nearestEntity((e) => isHostile(e) && e.position.distanceTo(me) <= maxDistance);
  return mob ?? null;
}

/** The entity a target string points at, or the nearest hostile within `maxDistance` if there is no target. */
export function resolveMobTarget(bot: Bot, target: string | undefined, maxDistance: number): Entity | null {
  if (target === undefined) return nearestHostile(bot, maxDistance);
  const parsed = parseTarget(target);
  const resolved = parsed && resolveTarget(bot, parsed);
  return resolved?.kind === "entity" ? resolved.entity : null;
}

/** False once the entity has died, despawned or left render distance. */
export function isStillThere(bot: Bot, entity: Entity): boolean {
  return entity.isValid && bot.entities[entity.id] === entity;
}
