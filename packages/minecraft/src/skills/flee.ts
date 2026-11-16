import type { Skill } from "@familiar/contracts";
import type { Bot } from "mineflayer";
import { hasLineOfSight } from "../line-of-sight.js";
import type { Entity } from "../mc-types.js";
import { isStillThere, resolveMobTarget } from "../mobs.js";
import type { MinecraftCtx } from "../skill-context.js";

const SAFE_DISTANCE = 16;

/** Runs from a mob (or the nearest hostile) until 16+ blocks away or out of its sight, preferring the way home. */
export const flee: Skill<MinecraftCtx> = {
  name: "flee",
  description: "Run away from a mob (default: the nearest hostile), heading toward base when possible.",
  parts: ["legs", "hands"],

  canRun(ctx, target) {
    // Nothing to flee from, or already safe from it: fleeing would end at once.
    const threat = resolveMobTarget(ctx.bot, target, SAFE_DISTANCE);
    return threat !== null && !isSafe(ctx.bot, threat);
  },

  async run(ctx, target, signal) {
    const { bot } = ctx;
    const threat = resolveMobTarget(bot, target, SAFE_DISTANCE);
    if (!threat) return { status: "failed", reason: "nothing to flee from" };
    ctx.log(`flee: running from ${threat.name ?? "entity"} ${threat.id}`);
    return ctx.locomotion.awayFrom(threat, { distance: SAFE_DISTANCE, prefer: ctx.base.chest, until: () => isSafe(bot, threat) }, signal);
  },
};

function isSafe(bot: Bot, threat: Entity): boolean {
  if (!isStillThere(bot, threat)) return true;
  return threat.position.distanceTo(bot.entity.position) >= SAFE_DISTANCE || !hasLineOfSight(bot, threat);
}
