import type { Skill } from "@familiar/contracts";
import type { Bot } from "mineflayer";
import { sleepFor } from "../abort.js";
import { airOf } from "../body.js";
import { nearestSpot } from "../safety.js";
import { releaseKeys } from "../primitives/keys.js";
import type { MinecraftCtx } from "../skill-context.js";
import { steerToward } from "../steer.js";

const SEARCH_RADIUS = 8;
const STEP_MS = 100;
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
    bot.pathfinder.setGoal(null);
    const started = Date.now();
    ctx.log(`surface: swimming up (air ${airOf(bot.entity)}/20)`);
    try {
      while (headInWater(bot) || airOf(bot.entity) < ENOUGH_AIR) {
        if (Date.now() - started > GIVE_UP_MS) return { status: "failed", reason: "no air reached in 20 s" };
        // The nearest water block with air above it: straight up if the way is open.
        const top = headInWater(bot)
          ? nearestSpot(bot, SEARCH_RADIUS, (pos) => bot.blockAt(pos)?.name === "water" && bot.blockAt(pos.offset(0, 1, 0))?.boundingBox === "empty" && bot.blockAt(pos.offset(0, 1, 0))?.name !== "water")
          : null;
        await steerToward(bot, top, true);
        await sleepFor(STEP_MS, signal);
      }
      return { status: "done" };
    } catch (error) {
      if (signal.aborted) return { status: "interrupted" };
      throw error;
    } finally {
      releaseKeys(bot);
    }
  },
};

function headInWater(bot: Bot): boolean {
  return bot.blockAt(bot.entity.position.offset(0, bot.entity.height * 0.9, 0))?.name === "water";
}
