import type { Bot } from "mineflayer";
import type { Vec3 } from "vec3";
import type { Block, Entity } from "../mc-types.js";
import { REACH, resolveTarget, type ResolvedTarget } from "../resolve-target.js";
import { parseTarget, type Direction } from "../target.js";

export { REACH };
/** A primitive is over within about this long. */
export const PRIMITIVE_MS = 900;
/** With no target, the primitives that act on something act on what the bot is looking at. */
export const AHEAD = "ahead";

type InventoryItem = ReturnType<Bot["inventory"]["items"]>[number];

/** What a target string points at right now, or null. */
export function resolve(bot: Bot, target: string | undefined): ResolvedTarget | null {
  const parsed = target === undefined ? null : parseTarget(target);
  return parsed && resolveTarget(bot, parsed);
}

/** The entity a target string points at, or null. */
export function entityOf(bot: Bot, target: string | undefined): Entity | null {
  const resolved = resolve(bot, target);
  return resolved?.kind === "entity" ? resolved.entity : null;
}

/** The block position a target string points at (a block or a bare position), or null. */
export function blockPosOf(bot: Bot, target: string | undefined): Vec3 | null {
  const resolved = resolve(bot, target);
  if (resolved?.kind === "block") return resolved.block.position;
  return resolved?.kind === "position" ? resolved.position.floored() : null;
}

/** The solid (or otherwise present) block a target string points at, or null for empty space. */
export function blockOf(bot: Bot, target: string | undefined): Block | null {
  const pos = blockPosOf(bot, target);
  const block = pos && bot.blockAt(pos);
  return block && block.name !== "air" && block.name !== "cave_air" ? block : null;
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

/** The direction a "dir:<direction>" target names, or null. */
export function directionOf(target: string | undefined): Direction | null {
  const parsed = target === undefined ? null : parseTarget(target);
  return parsed?.kind === "dir" ? parsed.dir : null;
}

/** The carried stack a target names ("held", or "item:<name>"), or null. */
export function carriedItem(bot: Bot, target: string | undefined): InventoryItem | null {
  const resolved = resolve(bot, target);
  if (resolved?.kind !== "item") return null;
  return bot.inventory.items().find((i) => i.name === resolved.name) ?? null;
}

/** An error's message, for a failure reason. */
export function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
