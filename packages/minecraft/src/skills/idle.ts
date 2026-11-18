import type { Skill } from "@familiar/contracts";
import { sleepFor } from "../abort.js";
import type { MinecraftCtx } from "../skill-context.js";

const PAUSE_MS = 1000;

/**
 * Stands still. Runs until aborted. It uses no part of the body, so anything may run beside it:
 * looking around while idle is the colliculus's doing (a glance every few seconds), not this skill's.
 */
export const idle: Skill<MinecraftCtx> = {
  name: "idle",
  description: "Stand still and look around. Never finishes on its own.",
  parts: [],

  canRun() {
    return true;
  },

  async run(_ctx, _target, signal) {
    try {
      while (true) await sleepFor(PAUSE_MS, signal);
    } catch (error) {
      if (signal.aborted) return { status: "interrupted" };
      throw error;
    }
  },
};
