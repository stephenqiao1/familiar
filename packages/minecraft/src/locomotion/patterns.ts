import type { Bot } from "mineflayer";
import { afloat, inLiquid } from "./swim.js";
import type { PatternName } from "./types.js";

/**
 * Chooses the pattern from what the body senses. An urgent journey always steers straight
 * (swimming if it is in liquid, dashing if not). Otherwise the bot walks until it is afloat, and
 * swims until its feet are out of the liquid again.
 *
 * SLOT: more patterns go here, each a small file like walk.ts or swim.ts and one more branch
 * below. Not built yet: climbing (ladders and vines, when the bot is on one) and boats (when it
 * is riding one).
 */
export function choosePattern(bot: Bot, urgent: boolean, current: PatternName | null): PatternName {
  if (urgent) return inLiquid(bot) ? "swim" : "dash";
  if (current === "swim") return inLiquid(bot) ? "swim" : "walk";
  return afloat(bot) ? "swim" : "walk";
}
