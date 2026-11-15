import type { Skill } from "@familiar/contracts";
import { sleepFor } from "../abort.js";
import { isBurning } from "../body.js";
import { inLavaOrFire, isSafeToStand, nearestSpot } from "../safety.js";
import type { MinecraftCtx } from "../skill-context.js";
import { steerToward } from "../steer.js";

const SEARCH_RADIUS = 6;
const STEP_MS = 100;
const GIVE_UP_MS = 12_000;

/**
 * Gets out of lava or fire to the nearest safe place to stand; if burning with water close, goes
 * into the water instead. Then stays put until the burning stops. Reflex-only.
 */
export const escapeHazard: Skill<MinecraftCtx> = {
  name: "escape_hazard",
  description: "Get out of lava or fire to the nearest safe ground, or into water if burning.",
  reflexOnly: true,

  canRun(ctx) {
    return inLavaOrFire(ctx.bot) || isBurning(ctx.bot.entity);
  },

  async run(ctx, _target, signal) {
    const { bot } = ctx;
    bot.pathfinder.setGoal(null);
    const started = Date.now();
    ctx.log("escape_hazard: getting out");
    try {
      while (inLavaOrFire(bot) || isBurning(bot.entity)) {
        if (Date.now() - started > GIVE_UP_MS) return { status: "failed", reason: "still in danger after 12 s" };
        const inIt = inLavaOrFire(bot);
        const water = isBurning(bot.entity) ? nearestSpot(bot, SEARCH_RADIUS, (pos) => bot.blockAt(pos)?.name === "water") : null;
        const goal = water ?? (inIt ? nearestSpot(bot, SEARCH_RADIUS, (pos) => isSafeToStand(bot, pos)) : null);
        // Out of the fire with no water to reach: stand still and let it burn out.
        if (goal === null && !inIt) bot.clearControlStates();
        // Jump to swim up out of lava or over a ledge; on open ground walk, so it drops into the water rather than hopping over it.
        else await steerToward(bot, goal, inIt || blocked(bot));
        await sleepFor(STEP_MS, signal);
      }
      return { status: "done" };
    } catch (error) {
      if (signal.aborted) return { status: "interrupted" };
      throw error;
    } finally {
      bot.clearControlStates();
    }
  },
};

/** Walking into something: a ledge to hop. */
function blocked(bot: MinecraftCtx["bot"]): boolean {
  return (bot.entity as { isCollidedHorizontally?: boolean }).isCollidedHorizontally === true;
}
