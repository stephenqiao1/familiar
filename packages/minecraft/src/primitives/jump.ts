import type { Bot } from "mineflayer";
import { sleepFor } from "../abort.js";
import { postureCheck } from "../posture/check.js";
import { holdKey } from "./keys.js";
import { primitive } from "./primitive.js";

const HOLD_MS = 250;
/** A jump lasts about this long: where the body is heading for that long is where it comes down. */
const AIR_SECONDS = 0.6;
const TICKS_PER_SECOND = 20;

/** Where a jump from here would come down, carried by how the body is already moving. */
function comesDownAt(bot: Bot) {
  const { position, velocity } = bot.entity;
  return position.offset(velocity.x * TICKS_PER_SECOND * AIR_SECONDS, 0, velocity.z * TICKS_PER_SECOND * AIR_SECONDS).floored();
}

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
    // A standing jump comes down where it started; a moving one may not.
    const to = comesDownAt(ctx.bot);
    const unsteady = to.equals(ctx.bot.entity.position.floored()) ? null : postureCheck(ctx.bot, "jump", { kind: "move", to });
    if (unsteady) return { status: "failed", reason: unsteady };
    await doJump(ctx.bot, signal);
    return { status: "done" };
  },
});
