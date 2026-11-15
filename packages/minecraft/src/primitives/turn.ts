import type { Bot } from "mineflayer";
import type { Direction } from "../target.js";
import { directionOf } from "./aim.js";
import { primitive } from "./primitive.js";

/** One turn is this many degrees. */
export const TURN_DEGREES = 45;
const LIMIT = Math.PI / 2;
const TURNS: readonly Direction[] = ["left", "right", "up", "down"];

/** Turns the head left, right, up or down by a fixed angle. Looking straight up or down is the limit. */
export async function doTurn(bot: Bot, dir: Direction, degrees = TURN_DEGREES): Promise<void> {
  const angle = (degrees * Math.PI) / 180;
  const { yaw, pitch } = bot.entity;
  // Yaw grows counter-clockwise, so left adds to it; pitch grows upward.
  const nextYaw = dir === "left" ? yaw + angle : dir === "right" ? yaw - angle : yaw;
  const nextPitch = dir === "up" ? pitch + angle : dir === "down" ? pitch - angle : pitch;
  await bot.look(nextYaw, Math.max(-LIMIT, Math.min(LIMIT, nextPitch)), true);
}

/** Looks left, right, up or down by a fixed angle. Needs no target to look at. */
export const turn = primitive({
  name: "turn",
  description: "Turn the head 45 degrees: dir:left, dir:right, dir:up or dir:down (default: right).",
  parts: ["head"],
  expects: ["turned"],
  settleMs: 0,

  canRun(_ctx, target) {
    return target === undefined || TURNS.includes(directionOf(target) as Direction);
  },

  async run(ctx, target, signal) {
    const dir = target === undefined ? "right" : directionOf(target);
    if (!dir || !TURNS.includes(dir)) return { status: "failed", reason: `cannot turn "${target}"` };
    await doTurn(ctx.bot, dir);
    return signal.aborted ? { status: "interrupted" } : { status: "done" };
  },
});
