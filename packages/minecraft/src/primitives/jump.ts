import type { Bot } from "mineflayer";
import { sleepFor } from "../abort.js";
import { holdKey } from "./keys.js";
import { primitive } from "./primitive.js";

const HOLD_MS = 250;

/** Jumps once: presses jump, and always lets go. */
export async function doJump(bot: Bot, signal: AbortSignal): Promise<void> {
  holdKey(bot, "jump", true);
  try {
    await sleepFor(HOLD_MS, signal);
  } finally {
    holdKey(bot, "jump", false);
  }
}

/** Jumps once. */
export const jump = primitive({
  name: "jump",
  description: "Jump once.",
  parts: ["legs"],
  expects: [],
  settleMs: 0,

  canRun() {
    return true;
  },

  async run(ctx, _target, signal) {
    await doJump(ctx.bot, signal);
    return { status: "done" };
  },
});
