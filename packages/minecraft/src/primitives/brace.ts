import type { Skill } from "@familiar/contracts";
import { sleepFor } from "../abort.js";
import type { MinecraftCtx } from "../skill-context.js";
import { pointOf } from "./aim.js";

const HOLD_MS = 250;

/** Stops moving and faces a point for a moment: the body's answer to being startled. */
export const brace: Skill<MinecraftCtx> = {
  name: "brace",
  description: "Stop moving and face a target (or just stop) for a moment.",
  primitive: true,

  canRun() {
    return true;
  },

  async run(ctx, target, signal) {
    const { bot } = ctx;
    bot.pathfinder.setGoal(null);
    bot.clearControlStates();
    try {
      const point = pointOf(bot, target);
      if (point) await bot.lookAt(point, true);
      await sleepFor(HOLD_MS, signal);
      return { status: "done" };
    } catch (error) {
      if (signal.aborted) return { status: "interrupted" };
      throw error;
    }
  },
};
