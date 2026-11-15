import type { Bot } from "mineflayer";
import type { Vec3 } from "vec3";
import type { Entity } from "../mc-types.js";
import { resolveTarget } from "../resolve-target.js";
import { parseTarget } from "../target.js";

/** A primitive is over within about this long. */
export const PRIMITIVE_MS = 900;
/** How far the bot's arm reaches. */
export const REACH = 4;

/** The entity a target string points at, or null. */
export function entityOf(bot: Bot, target: string | undefined): Entity | null {
  const parsed = target === undefined ? null : parseTarget(target);
  const resolved = parsed && resolveTarget(bot, parsed);
  return resolved?.kind === "entity" ? resolved.entity : null;
}

/** The block position a target string points at (a block or a bare position), or null. */
export function blockPosOf(bot: Bot, target: string | undefined): Vec3 | null {
  const parsed = target === undefined ? null : parseTarget(target);
  const resolved = parsed && resolveTarget(bot, parsed);
  if (resolved?.kind === "block") return resolved.block.position;
  return resolved?.kind === "position" ? resolved.position.floored() : null;
}

/** The point to face for a target: an entity's upper body, or the middle of a block or position. */
export function pointOf(bot: Bot, target: string | undefined): Vec3 | null {
  const entity = entityOf(bot, target);
  if (entity) return entity.position.offset(0, entity.height * 0.8, 0);
  return blockPosOf(bot, target)?.offset(0.5, 0.5, 0.5) ?? null;
}

/** Whether a point is within arm's reach of the bot's eyes. */
export function withinReach(bot: Bot, point: Vec3): boolean {
  return bot.entity.position.offset(0, bot.entity.height, 0).distanceTo(point) <= REACH;
}
