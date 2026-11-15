import type { Skill } from "@familiar/contracts";
import type { MinecraftCtx } from "../skill-context.js";
import { pointOf } from "./aim.js";

/** Turns the head to face a target. */
export const lookAt: Skill<MinecraftCtx> = {
  name: "look_at",
  description: "Turn to face a target (entity:<id>, pos:x,y,z, nearest:<name>, player:<name>).",
  primitive: true,

  canRun(ctx, target) {
    return pointOf(ctx.bot, target) !== null;
  },

  async run(ctx, target, signal) {
    const point = pointOf(ctx.bot, target);
    if (!point) return { status: "failed", reason: `target "${target}" not found` };
    await ctx.bot.lookAt(point, true);
    return signal.aborted ? { status: "interrupted" } : { status: "done" };
  },
};
