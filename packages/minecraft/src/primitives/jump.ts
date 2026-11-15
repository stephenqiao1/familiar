import type { Skill } from "@familiar/contracts";
import { sleepFor } from "../abort.js";
import type { MinecraftCtx } from "../skill-context.js";

const HOLD_MS = 250;

/** Jumps once. */
export const jump: Skill<MinecraftCtx> = {
  name: "jump",
  description: "Jump once.",
  primitive: true,

  canRun() {
    return true;
  },

  async run(ctx, _target, signal) {
    ctx.bot.setControlState("jump", true);
    try {
      await sleepFor(HOLD_MS, signal);
      return { status: "done" };
    } catch (error) {
      if (signal.aborted) return { status: "interrupted" };
      throw error;
    } finally {
      ctx.bot.setControlState("jump", false);
    }
  },
};
