import type { Skill } from "@familiar/contracts";
import { Vec3 } from "vec3";
import { sleepFor } from "../abort.js";
import type { MinecraftCtx } from "../skill-context.js";

const LOOK_RADIUS = 6;
const MIN_PAUSE_MS = 1500;
const MAX_PAUSE_MS = 4000;

/** Stands still and slowly looks at random nearby points. Runs until aborted. */
export const idle: Skill<MinecraftCtx> = {
  name: "idle",
  description: "Stand still and look around. Never finishes on its own.",

  canRun() {
    return true;
  },

  async run(ctx, _target, signal) {
    const { bot } = ctx;
    try {
      while (true) {
        signal.throwIfAborted();
        const eye = bot.entity.position.offset(0, bot.entity.height, 0);
        // Not forced, so the head turns smoothly instead of snapping.
        await bot.lookAt(eye.plus(randomOffset()), false);
        await sleepFor(MIN_PAUSE_MS + Math.random() * (MAX_PAUSE_MS - MIN_PAUSE_MS), signal);
      }
    } catch (error) {
      if (signal.aborted) return { status: "interrupted" };
      throw error;
    }
  },
};

function randomOffset(): Vec3 {
  const angle = Math.random() * 2 * Math.PI;
  const distance = 2 + Math.random() * (LOOK_RADIUS - 2);
  return new Vec3(Math.cos(angle) * distance, (Math.random() - 0.5) * 3, Math.sin(angle) * distance);
}
