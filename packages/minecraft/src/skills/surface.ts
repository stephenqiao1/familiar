import type { Skill } from "@familiar/contracts";
import type { Bot } from "mineflayer";
import { airOf } from "../body.js";
import { nearestSpot } from "../safety.js";
import type { MinecraftCtx } from "../skill-context.js";

const SEARCH_RADIUS = 8;
const GIVE_UP_MS = 20_000;
/** Breath to get back before the skill counts as done. */
const ENOUGH_AIR = 10;

/** Swims up to air (toward the nearest open water surface) and stays there until it has its breath back. Reflex-only. */
export const surface: Skill<MinecraftCtx> = {
  name: "surface",
  description: "Swim up to the nearest air and stay there until breath is back.",
  reflexOnly: true,

  canRun(ctx) {
    return headInWater(ctx.bot) || airOf(ctx.bot.entity) < ENOUGH_AIR;
  },

  async run(ctx, _target, signal) {
    const { bot } = ctx;
    ctx.log(`surface: swimming up (air ${airOf(bot.entity)}/20)`);
    /** The nearest water block with air above it (straight up if the way is open); null once the head is out. */
    const top = () => {
      if (!headInWater(bot)) return null;
      const spot = nearestSpot(bot, SEARCH_RADIUS, (pos) => bot.blockAt(pos)?.name === "water" && bot.blockAt(pos.offset(0, 1, 0))?.boundingBox === "empty" && bot.blockAt(pos.offset(0, 1, 0))?.name !== "water");
      return spot?.offset(0.5, 0, 0.5) ?? null;
    };
    const tooLong = AbortSignal.timeout(GIVE_UP_MS);
    const result = await ctx.locomotion.goTo(top, { urgent: true, until: () => !headInWater(bot) && airOf(bot.entity) >= ENOUGH_AIR }, AbortSignal.any([signal, tooLong]));
    if (result.status === "interrupted" && !signal.aborted) return { ...result, status: "failed", reason: "no air reached in 20 s" };
    return result;
  },
};

function headInWater(bot: Bot): boolean {
  return bot.blockAt(bot.entity.position.offset(0, bot.entity.height * 0.9, 0))?.name === "water";
}
