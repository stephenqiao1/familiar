import type { Skill } from "@familiar/contracts";
import pathfinder from "mineflayer-pathfinder";
import type { MinecraftCtx } from "../skill-context.js";
import { walkTo } from "../walk-to.js";
import { pointOf, PRIMITIVE_MS } from "./aim.js";

const { GoalNear } = pathfinder.goals;
/** One step covers at most this many blocks. */
const STEP_BLOCKS = 3;

/** Takes a few steps toward a target, then stops. Not a journey: call it again to keep going. */
export const stepToward: Skill<MinecraftCtx> = {
  name: "step_toward",
  description: "Take a few steps (up to 3 blocks) toward a target.",
  primitive: true,

  canRun(ctx, target) {
    return pointOf(ctx.bot, target) !== null;
  },

  async run(ctx, target, signal) {
    const { bot } = ctx;
    const point = pointOf(bot, target);
    if (!point) return { status: "failed", reason: `target "${target}" not found` };
    const me = bot.entity.position;
    const gap = point.minus(me);
    const distance = Math.hypot(gap.x, gap.z);
    const spot = distance <= STEP_BLOCKS ? point : me.plus(gap.scaled(STEP_BLOCKS / distance));
    // The time limit ends the step, which is not a failure.
    const result = await walkTo(bot, new GoalNear(spot.x, spot.y, spot.z, 1), AbortSignal.any([signal, AbortSignal.timeout(PRIMITIVE_MS)]));
    return signal.aborted ? { status: "interrupted" } : result.status === "failed" ? result : { status: "done" };
  },
};
