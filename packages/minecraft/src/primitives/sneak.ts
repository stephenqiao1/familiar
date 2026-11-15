import type { Bot } from "mineflayer";
import { holdKey } from "./keys.js";
import { primitive } from "./primitive.js";

/** Holds sneak, or lets go of it. */
export function doSneak(bot: Bot, on: boolean): void {
  holdKey(bot, "sneak", on);
}

/**
 * Starts sneaking, or stops if already sneaking. Sneaking is a held posture, so it stays on after
 * this ends (that is its point); the next `sneak`, or `brace`, lets go.
 */
export const sneak = primitive({
  name: "sneak",
  description: "Start sneaking, or stop if already sneaking.",
  parts: ["legs"],
  expects: ["sneaking"],
  settleMs: 0,

  canRun() {
    return true;
  },

  async run(ctx) {
    doSneak(ctx.bot, !ctx.bot.getControlState("sneak"));
    return { status: "done" };
  },
});
