import type { Skill } from "@familiar/contracts";
import pathfinder from "mineflayer-pathfinder";
import type { MinecraftCtx } from "../skill-context.js";
import { walkTo } from "../walk-to.js";

const { GoalNear } = pathfinder.goals;
const RANGE = 2;

/** Walks back to within 2 blocks of the base chest. */
export const returnToBase: Skill<MinecraftCtx> = {
  name: "return_to_base",
  description: "Walk back to the base chest.",

  canRun(ctx) {
    return ctx.base?.chest !== undefined;
  },

  async run(ctx, _target, signal) {
    const { x, y, z } = ctx.base.chest;
    ctx.log(`return_to_base: heading for chest at ${ctx.base.chest}`);
    return walkTo(ctx.bot, new GoalNear(x, y, z, RANGE), signal);
  },
};
