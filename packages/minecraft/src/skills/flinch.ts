import type { Skill } from "@familiar/contracts";
import { sleepFor } from "../abort.js";
import { pointOf } from "../primitives/aim.js";
import { doLookAt } from "../primitives/look-at.js";
import type { MinecraftCtx } from "../skill-context.js";

/** A flinch freezes the body for about this long. */
export const FLINCH_MS = 150;

/**
 * A flinch: the small startle. The legs freeze for a moment and the head snaps to where it came
 * from, then everything carries on. It claims no part of the body, so it runs beside whatever
 * skill is under way and cancels nothing: a journey is paused and picks up again by itself.
 * Reflex-only.
 */
export const flinch: Skill<MinecraftCtx> = {
  name: "flinch",
  description: "Freeze for a moment and glance at what startled the bot, then carry on.",
  reflexOnly: true,
  parts: [],

  canRun: () => true,

  async run(ctx, target, signal) {
    const { bot, locomotion } = ctx;
    const resumes = locomotion.pause(FLINCH_MS);
    // The head goes to it unless the hands need the head where it is (a dig in progress).
    const point = pointOf(bot, target);
    if (point && !bot.targetDigBlock) await doLookAt(bot, point).catch(() => {});
    await sleepFor(FLINCH_MS, signal).catch(() => {});
    return { status: signal.aborted ? "interrupted" : "done", changes: { froze: FLINCH_MS, ...(resumes ? { journeyPaused: true } : {}) } };
  },
};
