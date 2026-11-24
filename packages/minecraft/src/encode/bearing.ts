import type { Vec3 } from "vec3";
import type { EncodableBot } from "./encodable-bot.js";
import type { Bearing } from "./state-data.js";

export type { Bearing };

// Where something is relative to the way the head faces, and whether the eyes can see it.

/** The field of view, in degrees either side of straight ahead: the edge of what can be seen at all, and of what is seen sharply. */
export const FIELD = { peripheral: 110, central: 30 };
const EYE_HEIGHT = 1.62;
const AHEAD_WITHIN = 45;
const BEHIND_BEYOND = 135;

/** The bearing of a point from a body at `from` whose head faces `yaw` (radians, growing to the left, 0 facing north). */
export function bearingOf(from: Vec3, yaw: number, to: Vec3): Bearing {
  const toward = Math.atan2(-(to.x - from.x), -(to.z - from.z));
  const turn = Math.atan2(Math.sin(toward - yaw), Math.cos(toward - yaw));
  const degrees = Math.round((turn * 180) / Math.PI) || 0;
  const angle = degrees === -180 ? 180 : degrees;
  const wide = Math.abs(angle);
  return { side: wide <= AHEAD_WITHIN ? "ahead" : wide >= BEHIND_BEYOND ? "behind" : angle > 0 ? "left" : "right", angle };
}

/** How far above (positive) or below eye level a point is, in whole degrees, from eyes at `eyes`. */
export function elevationOf(eyes: Vec3, to: Vec3): number {
  const flat = Math.hypot(to.x - eyes.x, to.z - eyes.z);
  return Math.round((Math.atan2(to.y - eyes.y, flat) * 180) / Math.PI) || 0;
}

/** The brighter of block light and sky light at a point, 0 to 15: sky light is dimmed at night the way the game dims it. Unloaded: 0. */
export function lightAt(bot: EncodableBot, at: Vec3): number {
  const block = bot.blockAt(at.floored());
  if (!block) return 0;
  return Math.max(block.light, block.skyLight - (bot.time.isDay ? 0 : NIGHT_SKY_DIMMING), 0);
}
const NIGHT_SKY_DIMMING = 11;

/** Where the bot's eyes are. */
export function eyesOf(bot: EncodableBot): Vec3 {
  return bot.entity.position.offset(0, EYE_HEIGHT, 0);
}

/** Whether nothing that blocks the view (solid, and not see-through like glass) lies between the bot's eyes and a point. (A fake world without rays sees everything.) */
export function clearLine(bot: EncodableBot, to: Vec3): boolean {
  if (!bot.world.raycast) return true;
  const from = eyesOf(bot);
  const distance = from.distanceTo(to);
  if (distance < 0.5) return true;
  // Stop just short, so a block is not hidden by itself.
  return bot.world.raycast(from, to.minus(from).scaled(1 / distance), Math.max(0, distance - 0.9), (block) => block.boundingBox === "block" && block.transparent !== true) === null;
}

/** A point's bearing, and whether it is seen: within the field of view with a clear line of sight. */
export function sightOf(bot: EncodableBot, to: Vec3): { bearing: Bearing; seen: boolean } {
  const bearing = bearingOf(bot.entity.position, bot.entity.yaw ?? 0, to);
  return { bearing, seen: Math.abs(bearing.angle) <= FIELD.peripheral && clearLine(bot, to) };
}
