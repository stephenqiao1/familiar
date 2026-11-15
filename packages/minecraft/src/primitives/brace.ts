import type { Bot } from "mineflayer";
import { sleepFor } from "../abort.js";
import { pointOf } from "./aim.js";
import { releaseKeys } from "./keys.js";
import { doLookAt } from "./look-at.js";
import { primitive } from "./primitive.js";

const HOLD_MS = 250;

/** Stops moving: drops any path being walked and lets go of every key. */
export function doStop(bot: Bot): void {
  bot.pathfinder.setGoal(null);
  releaseKeys(bot);
}

/** Stops moving and faces a point for a moment: the body's answer to being startled. */
export const brace = primitive({
  name: "brace",
  description: "Stop moving and face a target (or just stop) for a moment.",
  parts: ["legs", "head"],
  expects: [],
  settleMs: 0,

  canRun() {
    return true;
  },

  async run(ctx, target, signal) {
    const { bot } = ctx;
    doStop(bot);
    const point = pointOf(bot, target);
    if (point) await doLookAt(bot, point);
    await sleepFor(HOLD_MS, signal);
    return { status: "done" };
  },
});
