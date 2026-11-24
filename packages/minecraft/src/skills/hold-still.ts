import type { Skill } from "@familiar/contracts";
import { sleepFor } from "../abort.js";
import { isStillThere, resolveMobTarget } from "../mobs.js";
import { doLookAt } from "../primitives/look-at.js";
import { doSneak } from "../primitives/sneak.js";
import type { MinecraftCtx } from "../skill-context.js";

const WATCH_MS = 250;
/** It holds this long; the reflex asks again while there is still reason to. */
const HOLD_MS = 2500;
const LOOKUP_RADIUS = 64;

/**
 * Holding still and watching: for something passing overhead that has not come nearer. The body
 * stops, crouches and keeps its eyes on the thing for a moment. Unlike `freeze` it is not tied
 * to a threat the defence circuit has sized up. Reflex-only.
 */
export const holdStill: Skill<MinecraftCtx> = {
  name: "hold_still",
  description: "Stop, crouch and watch something for a moment.",
  reflexOnly: true,
  parts: ["legs", "head"],

  canRun: (ctx, target) => target !== undefined && resolveMobTarget(ctx.bot, target, LOOKUP_RADIUS) !== null,

  async run(ctx, target, signal) {
    const { bot, locomotion } = ctx;
    const thing = resolveMobTarget(bot, target, LOOKUP_RADIUS);
    if (!thing) return { status: "failed", reason: "nothing to watch" };
    const started = Date.now();
    locomotion.stop();
    doSneak(bot, true);
    ctx.log(`hold_still: holding still, watching ${thing.name ?? "entity"} ${thing.id}`);
    try {
      while (Date.now() - started < HOLD_MS && isStillThere(bot, thing)) {
        await doLookAt(bot, thing.position.offset(0, thing.height / 2, 0)).catch(() => {});
        await sleepFor(WATCH_MS, signal);
      }
      return { status: "done", changes: { heldMs: Date.now() - started } };
    } catch (error) {
      if (signal.aborted) return { status: "interrupted", changes: { heldMs: Date.now() - started } };
      throw error;
    } finally {
      doSneak(bot, false);
    }
  },
};
