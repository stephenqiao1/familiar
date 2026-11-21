import type { Skill } from "@familiar/contracts";
import { hasLineOfSight } from "../line-of-sight.js";
import type { Entity } from "../mc-types.js";
import { isStillThere, resolveMobTarget } from "../mobs.js";
import type { MinecraftCtx } from "../skill-context.js";

/** How far is safe from a threat the bot knows nothing about; one it has sized up is safe at twice its flight distance. */
const SAFE_DISTANCE = 16;
const safeFrom = (ctx: MinecraftCtx, threat: Entity) => ctx.threats?.safeDistance(threat) ?? SAFE_DISTANCE;

/**
 * Whether the threat is after the bot, by the defence circuit's own sizing up: it has noticed the
 * bot and can get to it. Such a one keeps coming whether or not it can be seen, so losing sight
 * of it is not safety. With no threat sense, nothing is known to be after the bot.
 */
const afterMe = (ctx: MinecraftCtx, threat: Entity) => ctx.threats?.latest()?.threats.some((t) => t.id === `entity:${threat.id}` && t.noticed && t.canReach) ?? false;

/** Runs from a mob (or the nearest hostile) until safely far (twice its flight distance), or out of the sight of one that is not after it, preferring the way home. */
export const flee: Skill<MinecraftCtx> = {
  name: "flee",
  description: "Run away from a mob (default: the nearest hostile), heading toward base when possible.",
  parts: ["legs", "hands"],

  canRun(ctx, target) {
    // Nothing to flee from, or already safe from it: fleeing would end at once.
    const threat = resolveMobTarget(ctx.bot, target, SAFE_DISTANCE);
    return threat !== null && !isSafe(ctx, threat, safeFrom(ctx, threat));
  },

  async run(ctx, target, signal) {
    const { bot } = ctx;
    const threat = resolveMobTarget(bot, target, SAFE_DISTANCE);
    if (!threat) return { status: "failed", reason: "nothing to flee from" };
    const safe = safeFrom(ctx, threat);
    ctx.log(`flee: running from ${threat.name ?? "entity"} ${threat.id} until ${Math.round(safe)} blocks away`);
    return ctx.locomotion.awayFrom(threat, { distance: safe, prefer: ctx.base.chest, until: () => isSafe(ctx, threat, safe) }, signal);
  },
};

function isSafe(ctx: MinecraftCtx, threat: Entity, distance: number): boolean {
  const { bot } = ctx;
  if (!isStillThere(bot, threat)) return true;
  return threat.position.distanceTo(bot.entity.position) >= distance || (!hasLineOfSight(bot, threat) && !afterMe(ctx, threat));
}
