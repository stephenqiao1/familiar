import type { Skill } from "@familiar/contracts";
import { isBurning } from "../body.js";
import { inLavaOrFire, isSafeToStand, nearestSpot } from "../safety.js";
import type { MinecraftCtx } from "../skill-context.js";

const SEARCH_RADIUS = 6;
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
    ctx.log("escape_hazard: getting out");
    const inDanger = () => inLavaOrFire(bot) || isBurning(bot.entity);
    /** Where to head right now: water if burning and some is close, else the nearest safe ground; null to stand and let it burn out. */
    const refuge = () => {
      const water = isBurning(bot.entity) ? nearestSpot(bot, SEARCH_RADIUS, (pos) => bot.blockAt(pos)?.name === "water") : null;
      const spot = water ?? (inLavaOrFire(bot) ? nearestSpot(bot, SEARCH_RADIUS, (pos) => isSafeToStand(bot, pos)) : null);
      return spot?.offset(0.5, 0, 0.5) ?? null;
    };
    const tooLong = AbortSignal.timeout(GIVE_UP_MS);
    const result = await ctx.locomotion.goTo(refuge, { urgent: true, until: () => !inDanger() }, AbortSignal.any([signal, tooLong]));
    if (result.status === "interrupted" && !signal.aborted) return { ...result, status: "failed", reason: "still in danger after 12 s" };
    return result;
  },
};
