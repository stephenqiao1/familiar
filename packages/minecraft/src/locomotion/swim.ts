import type { Bot } from "mineflayer";
import type { Vec3 } from "vec3";
import { holdKey } from "../primitives/keys.js";
import { doLookAt } from "../primitives/look-at.js";
import { inLavaOrFire } from "../safety.js";

/** Closer than this to the aim (across the ground), the legs stop pushing. */
const CLOSE = 0.3;
const LIQUIDS = new Set(["water", "lava"]);

/** The bot is floating: its head is in liquid, or its feet are and there is more liquid below. */
export function afloat(bot: Bot): boolean {
  const feet = bot.entity.position.floored();
  const at = (dy: number) => LIQUIDS.has(bot.blockAt(feet.offset(0, dy, 0))?.name ?? "");
  return at(1) || (at(0) && at(-1));
}

/** The feet are in liquid at all. */
export function inLiquid(bot: Bot): boolean {
  return LIQUIDS.has(bot.blockAt(bot.entity.position.floored())?.name ?? "");
}

/** Whether the legs still have ground to cover toward the aim. */
export function farFrom(bot: Bot, aim: Vec3 | null): boolean {
  const me = bot.entity.position;
  return aim !== null && Math.hypot(aim.x - me.x, aim.z - me.z) > CLOSE;
}

/**
 * The swim pattern, and the straight-line dash an urgent journey uses on land: heads straight
 * for the aim by holding keys, with no route planning (the pathfinder plans badly in liquid).
 * Jump is held in liquid (it swims up), against a ledge (it hops), and when standing in
 * something that burns. Call it again as the bot moves. With no aim it holds still.
 */
export async function steer(bot: Bot, aim: Vec3 | null, sprint: boolean): Promise<void> {
  const collided = (bot.entity as { isCollidedHorizontally?: boolean }).isCollidedHorizontally === true;
  const far = farFrom(bot, aim);
  holdKey(bot, "jump", inLiquid(bot) || afloat(bot) || inLavaOrFire(bot) || (far && collided));
  holdKey(bot, "forward", far);
  holdKey(bot, "sprint", far && sprint);
  if (far) await doLookAt(bot, aim!.offset(0, bot.entity.height, 0));
}
