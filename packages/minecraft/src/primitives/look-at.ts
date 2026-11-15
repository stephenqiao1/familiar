import type { Bot } from "mineflayer";
import type { Vec3 } from "vec3";
import { pointOf } from "./aim.js";
import { doGaze } from "./gaze.js";
import { primitive } from "./primitive.js";

/** While walking, a look is held this long (the legs carry on underneath it). */
const GAZE_MS = 1000;

/** Turns the head to face a point. `snap` false turns smoothly instead of at once. */
export async function doLookAt(bot: Bot, point: Vec3, snap = true): Promise<void> {
  await bot.lookAt(point, snap);
}

/**
 * Turns the head to face a target. If the pathfinder is walking the bot, the look is held for a
 * second while the legs keep going the way they were (see gaze.ts), following the target if it moves.
 */
export const lookAt = primitive({
  name: "look_at",
  description: "Turn to face a target (entity:<id>, pos:x,y,z, nearest:<name>, player:<name>, dir:<direction>).",
  parts: ["head"],
  expects: [],
  settleMs: 0,

  canRun(ctx, target) {
    return pointOf(ctx.bot, target) !== null;
  },

  async run(ctx, target, signal) {
    const point = pointOf(ctx.bot, target);
    if (!point) return { status: "failed", reason: `target "${target}" not found` };
    if (ctx.bot.pathfinder.isMoving()) await doGaze(ctx.bot, () => pointOf(ctx.bot, target), GAZE_MS, signal);
    else await doLookAt(ctx.bot, point);
    return signal.aborted ? { status: "interrupted" } : { status: "done" };
  },
});
