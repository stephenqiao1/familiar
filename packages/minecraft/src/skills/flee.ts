import type { Skill } from "@familiar/contracts";
import type { Bot } from "mineflayer";
import pathfinder from "mineflayer-pathfinder";
import type { Vec3 } from "vec3";
import { sleepFor } from "../abort.js";
import { hasLineOfSight } from "../line-of-sight.js";
import type { Entity } from "../mc-types.js";
import { isStillThere, resolveMobTarget } from "../mobs.js";
import type { MinecraftCtx } from "../skill-context.js";

const { GoalNear } = pathfinder.goals;
const SAFE_DISTANCE = 16;
const STEP = 8;
const REPLAN_MS = 500;

/** Runs from a mob (or the nearest hostile) until 16+ blocks away or out of its sight, preferring the way home. */
export const flee: Skill<MinecraftCtx> = {
  name: "flee",
  description: "Run away from a mob (default: the nearest hostile), heading toward base when possible.",

  canRun(ctx, target) {
    return resolveMobTarget(ctx.bot, target, SAFE_DISTANCE) !== null;
  },

  async run(ctx, target, signal) {
    const { bot } = ctx;
    const threat = resolveMobTarget(bot, target, SAFE_DISTANCE);
    if (!threat) return { status: "failed", reason: "nothing to flee from" };
    ctx.log(`flee: running from ${threat.name ?? "entity"} ${threat.id}`);

    try {
      while (!isSafe(bot, threat)) {
        bot.pathfinder.setGoal(new GoalNear(...xyz(fleePoint(bot, threat, ctx.base.chest)), 1));
        await sleepFor(REPLAN_MS, signal);
      }
      return { status: "done" };
    } catch (error) {
      if (signal.aborted) return { status: "interrupted" };
      throw error;
    } finally {
      bot.pathfinder.setGoal(null);
    }
  },
};

function isSafe(bot: Bot, threat: Entity): boolean {
  if (!isStillThere(bot, threat)) return true;
  return threat.position.distanceTo(bot.entity.position) >= SAFE_DISTANCE || !hasLineOfSight(bot, threat);
}

/**
 * A point a few blocks away from the threat. If home is not behind the threat, lean toward it.
 */
function fleePoint(bot: Bot, threat: Entity, home: Vec3): Vec3 {
  const me = bot.entity.position;
  const away = flat(me.minus(threat.position));
  const toHome = flat(home.minus(me));
  const dot = away.x * toHome.x + away.z * toHome.z;
  const direction = dot > 0 ? flat(away.plus(toHome)) : away;
  return me.plus(direction.scaled(STEP));
}

/** Horizontal unit vector (falls back to +x when zero). */
function flat(v: Vec3): Vec3 {
  const h = v.clone();
  h.y = 0;
  const length = Math.hypot(h.x, h.z);
  return length === 0 ? h.set(1, 0, 0) : h.scaled(1 / length);
}

function xyz(v: Vec3): [number, number, number] {
  return [v.x, v.y, v.z];
}
