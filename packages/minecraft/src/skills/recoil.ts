import type { Skill, SkillResult } from "@familiar/contracts";
import type { Vec3 } from "vec3";
import { doSneak } from "../primitives/sneak.js";
import { isSafeToStand } from "../safety.js";
import type { MinecraftCtx } from "../skill-context.js";
import { parseTarget } from "../target.js";

const BACK_MS = 1200;

/** Where a "pos:x,y,z" target points, or null. */
function spotOf(ctx: MinecraftCtx, target: string | undefined): Vec3 | null {
  const parsed = target === undefined ? null : parseTarget(target);
  return parsed?.kind === "pos" ? ctx.bot.entity.position.clone().set(parsed.x, parsed.y, parsed.z) : null;
}

/**
 * Stops at once, then steps back to the given spot (if it is safe to stand there), sneaking the
 * whole time: a sneaking player cannot walk off an edge. Sneak is let go at the end.
 */
async function stopAndStepBack(ctx: MinecraftCtx, target: string | undefined, signal: AbortSignal): Promise<SkillResult> {
  const { bot, locomotion } = ctx;
  locomotion.stop();
  const back = spotOf(ctx, target);
  doSneak(bot, true);
  try {
    if (!back || !isSafeToStand(bot, back.floored())) return { status: "done", changes: { stopped: true, steppedBack: false } };
    const journey = await locomotion.goTo(back, { urgent: true, range: 0.3 }, AbortSignal.any([signal, AbortSignal.timeout(BACK_MS)]));
    return { status: signal.aborted ? "interrupted" : "done", changes: { stopped: true, steppedBack: journey.status === "done" } };
  } finally {
    doSneak(bot, false);
  }
}

/** The hard version: about to touch something that hurts. Whatever was running is switched off. Reflex-only. */
export const recoil: Skill<MinecraftCtx> = {
  name: "recoil",
  description: "Stop at once and step back from something about to hurt.",
  reflexOnly: true,
  canRun: () => true,
  run: stopAndStepBack,
};

/** The soft version: hold ground against a push, or stop short of an edge. Reflex-only. */
export const steady: Skill<MinecraftCtx> = {
  name: "steady",
  description: "Hold ground: sneak and step back from an edge or from where a push is carrying the bot.",
  reflexOnly: true,
  canRun: () => true,
  run: stopAndStepBack,
};
