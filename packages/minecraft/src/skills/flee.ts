import type { Skill } from "@familiar/contracts";
import type { Bot } from "mineflayer";
import { hasLineOfSight } from "../line-of-sight.js";
import type { Entity } from "../mc-types.js";
import { isStillThere, resolveMobTarget } from "../mobs.js";
import type { MinecraftCtx } from "../skill-context.js";

/** How far is safe from a threat the bot knows nothing about; one it has sized up is safe at twice its flight distance. */
const SAFE_DISTANCE = 16;
const safeFrom = (ctx: MinecraftCtx, threat: Entity) => ctx.threats?.safeDistance(threat) ?? SAFE_DISTANCE;

/** Runs from a mob (or the nearest hostile) until safely far (twice its flight distance) or out of its sight, preferring the way home. */
export const flee: Skill<MinecraftCtx> = {
  name: "flee",
  description: "Run away from a mob (default: the nearest hostile), heading toward base when possible.",
  parts: ["legs", "hands"],

  canRun(ctx, target) {
    // Nothing to flee from, or already safe from it: fleeing would end at once.
    const threat = resolveMobTarget(ctx.bot, target, SAFE_DISTANCE);
    return threat !== null && !isSafe(ctx.bot, threat, safeFrom(ctx, threat));
  },

  async run(ctx, target, signal) {
    const { bot } = ctx;
    const threat = resolveMobTarget(bot, target, SAFE_DISTANCE);
    if (!threat) return { status: "failed", reason: "nothing to flee from" };
    const safe = safeFrom(ctx, threat);
    ctx.log(`flee: running from ${threat.name ?? "entity"} ${threat.id} until ${Math.round(safe)} blocks away`);
    return ctx.locomotion.awayFrom(threat, { distance: safe, prefer: ctx.base.chest, until: () => isSafe(bot, threat, safe) }, signal);
  },
};

function isSafe(bot: Bot, threat: Entity, distance: number): boolean {
  if (!isStillThere(bot, threat)) return true;
  return threat.position.distanceTo(bot.entity.position) >= distance || !hasLineOfSight(bot, threat);
}
