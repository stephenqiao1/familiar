import type { Bot } from "mineflayer";
import { sleepFor } from "../abort.js";
import { stepOf } from "../facing.js";
import { isSafeToStand } from "../safety.js";
import type { Direction } from "../target.js";
import { directionOf, PRIMITIVE_MS } from "./aim.js";
import { holdKey, releaseKeys, type Key } from "./keys.js";
import { primitive } from "./primitive.js";

const STEPS: readonly Direction[] = ["forward", "back", "left", "right"];
const POLL_MS = 50;

/**
 * Walks one block forward, back, left or right of where the bot faces, by holding that key
 * until it has moved a block (or time is up). Always lets go of the key.
 */
export async function doStep(bot: Bot, dir: Direction, signal: AbortSignal): Promise<void> {
  const from = bot.entity.position.clone();
  const started = Date.now();
  try {
    holdKey(bot, dir as Key, true);
    while (Date.now() - started < PRIMITIVE_MS) {
      const moved = bot.entity.position.minus(from);
      if (Math.hypot(moved.x, moved.z) >= 1) break;
      await sleepFor(POLL_MS, signal);
    }
  } finally {
    releaseKeys(bot);
  }
}

/** Whether the block one step away is somewhere safe to stand (not a drop, lava, fire or a wall). */
function safeStep(bot: Bot, dir: Direction): boolean {
  const feet = bot.entity.position.floored();
  const to = feet.plus(stepOf(bot.entity.yaw, dir));
  // One block up or down is an ordinary step; anything else is a wall or a drop.
  return [0, -1, 1].some((dy) => isSafeToStand(bot, to.offset(0, dy, 0)));
}

/** Takes one step relative to where the bot faces. Needs no target to walk to. */
export const step = primitive({
  name: "step",
  description: "Step one block: dir:forward, dir:back, dir:left or dir:right of where the bot faces (default: forward).",
  parts: ["legs"],
  expects: ["moved"],
  settleMs: 0,

  canRun(ctx, target) {
    const dir = target === undefined ? "forward" : directionOf(target);
    return dir !== null && STEPS.includes(dir) && safeStep(ctx.bot, dir);
  },

  async run(ctx, target, signal) {
    const dir = target === undefined ? "forward" : directionOf(target);
    if (!dir || !STEPS.includes(dir)) return { status: "failed", reason: `cannot step "${target}"` };
    if (!safeStep(ctx.bot, dir)) return { status: "failed", reason: "nowhere safe to stand that way" };
    ctx.locomotion.stop();
    await doStep(ctx.bot, dir, signal);
    return { status: "done" };
  },
});
