import type { Bot } from "mineflayer";
import type { Block } from "../mc-types.js";
import { isProtectedBlock } from "../protected.js";
import { isSafeToDig } from "../safety.js";
import { AHEAD, blockOf, reasonOf } from "./aim.js";
import { primitive } from "./primitive.js";

/**
 * Digs one block until it breaks. If `signal` fires it stops digging at once (the dig's progress
 * is lost: the game does not let a dig be paused). Returns how far it got, from 0 to 1.
 */
export async function doBreak(bot: Bot, block: Block, signal: AbortSignal): Promise<number> {
  const needed = Math.max(1, bot.digTime(block));
  const started = Date.now();
  const onAbort = () => bot.stopDigging();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    await bot.dig(block);
    return 1;
  } catch (error) {
    if (!signal.aborted) throw error;
    return Math.min(0.99, (Date.now() - started) / needed);
  } finally {
    signal.removeEventListener("abort", onAbort);
    // Whatever happened, the arm is not left swinging at the block.
    if (bot.targetDigBlock) bot.stopDigging();
  }
}

/**
 * Breaks one block within reach with whatever is in hand. The one long primitive: a block must
 * be dug in one go, so it runs until the block breaks or it is told to stop, and reports how far
 * it got in `changes.progress`.
 */
export const breakBlock = primitive({
  name: "break_block",
  description: "Break one block within reach (pos:x,y,z, nearest:<name>, dir:<direction> or ahead; default: ahead) with what is in hand.",
  parts: ["hands", "head"],
  expects: ["targetBlock=air"],
  long: true,
  settleMs: 300,
  defaultTarget: () => AHEAD,

  canRun(ctx, target) {
    return breakable(ctx.bot, target) !== null;
  },

  async run(ctx, target, signal) {
    const { bot } = ctx;
    const block = breakable(bot, target);
    if (!block) return { status: "failed", reason: `cannot break "${target ?? AHEAD}"` };
    ctx.log(`break_block: ${block.name}, about ${(bot.digTime(block) / 1000).toFixed(1)} s`);
    try {
      const progress = await doBreak(bot, block, signal);
      return { status: progress >= 1 ? "done" : "interrupted", changes: { progress: Math.round(progress * 1000) / 1000 } };
    } catch (error) {
      return { status: "failed", reason: reasonOf(error) };
    }
  },
});

/** The block at the target if it can be dug from here, is not protected, and is safe to remove. */
function breakable(bot: Bot, target: string | undefined): Block | null {
  const block = blockOf(bot, target ?? AHEAD);
  if (!block || block.boundingBox === "empty" || isProtectedBlock(block.name)) return null;
  return bot.canDigBlock(block) && isSafeToDig(bot, block) ? block : null;
}
