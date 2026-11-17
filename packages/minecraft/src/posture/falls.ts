import type { Bot } from "mineflayer";
import type { Vec3 } from "vec3";
import { isClimbable } from "../encode/balance.js";
import { postureOf, type Fall } from "./runtime.js";

// Feels each fall from start to landing: how far, what it cost, and where the body left the ground.

export interface FallSense {
  /** How far the body has come down so far in the fall under way (0 on the ground). */
  fallen(): number;
}

/** Less than this is a jump or a step down, not a fall. */
const A_FALL = 1.5;
/** The hurt from a landing arrives a moment after it. */
const HURT_ARRIVES_MS = 300;

const steering = new WeakMap<object, () => void>();

/** Notes that the body is steering for a better landing in the fall under way. */
export function markSteering(bot: object): void {
  steering.get(bot)?.();
}

/**
 * Watches the bot fall. On landing it notes the fall (blocks fallen, damage, whether it steered)
 * and calls `onFall` with the spot where the bot last stood, so an edge that hurt can be avoided.
 */
export function trackFalls(bot: Bot, onFall: (fall: Fall, edge: Vec3 | null) => void = () => {}): FallSense {
  let air: { top: number; health: number; edge: Vec3 | null; steered: boolean } | null = null;
  let stood: Vec3 | null = null;
  const supported = () => {
    const e = bot.entity as { onGround: boolean; isInWater?: boolean };
    return e.onGround || e.isInWater === true || isClimbable(bot.blockAt(bot.entity.position.floored())?.name ?? "");
  };
  steering.set(bot, () => {
    if (air) air.steered = true;
  });

  bot.on("physicsTick", () => {
    const here = bot.entity.position;
    if (!supported()) {
      air ??= { top: here.y, health: bot.health, edge: stood, steered: false };
      air.top = Math.max(air.top, here.y);
      return;
    }
    const fell = air;
    air = null;
    stood = here.clone();
    if (!fell || fell.top - here.y < A_FALL) return;
    const blocks = Math.round((fell.top - here.y) * 10) / 10;
    const onto = (bot.entity as { isInWater?: boolean }).isInWater ? "water" : (bot.blockAt(here.offset(0, -0.2, 0))?.name ?? "unknown");
    setTimeout(() => {
      const damage = Math.max(0, Math.round((fell.health - bot.health) * 10) / 10);
      const fall: Fall = { blocks, damage, steered: fell.steered, onto, ...(damage > 0 && !fell.steered ? { note: "no better landing in reach: nothing to do" } : {}) };
      postureOf(bot).fell(fall);
      onFall(fall, fell.edge);
    }, HURT_ARRIVES_MS);
  });
  // A new body, or one moved somewhere else, is not mid-fall.
  const forget = () => {
    air = null;
    stood = null;
  };
  bot.on("death", forget);
  bot.on("spawn", forget);
  bot.on("forcedMove", forget);
  return { fallen: () => (air ? Math.max(0, air.top - bot.entity.position.y) : 0) };
}
