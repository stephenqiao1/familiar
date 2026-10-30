import type { Bot } from "mineflayer";
import type { Entity } from "./mc-types.js";

/** True if no solid block sits between the bot's eyes and the entity's eyes. */
export function hasLineOfSight(bot: Bot, entity: Entity): boolean {
  const from = bot.entity.position.offset(0, bot.entity.height, 0);
  const to = entity.position.offset(0, entity.height, 0);
  const distance = from.distanceTo(to);
  if (distance === 0) return true;
  const direction = to.minus(from).scaled(1 / distance);
  const hit = bot.world.raycast(from, direction, distance, (block) => block.boundingBox === "block");
  return hit === null;
}
