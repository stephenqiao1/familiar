import type { Skill } from "@familiar/contracts";
import type { Bot } from "mineflayer";
import type { Block } from "../mc-types.js";
import { isProtectedBlock } from "../protected.js";
import { isSafeToDig } from "../safety.js";
import type { MinecraftCtx } from "../skill-context.js";
import { blockPosOf } from "./aim.js";

/**
 * Breaks one block within reach with whatever is in hand. The one primitive that can take longer
 * than a second: a block must be dug in one go (stopping loses the progress), so it runs until
 * the block breaks or it is told to stop.
 */
export const breakBlock: Skill<MinecraftCtx> = {
  name: "break_block",
  description: "Break one block within reach (pos:x,y,z or nearest:<name>) with what is in hand.",
  primitive: true,

  canRun(ctx, target) {
    return breakable(ctx.bot, target) !== null;
  },

  async run(ctx, target, signal) {
    const { bot } = ctx;
    const block = breakable(bot, target);
    if (!block) return { status: "failed", reason: `cannot break "${target}"` };
    const onAbort = () => bot.stopDigging();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      await bot.dig(block);
      return signal.aborted ? { status: "interrupted" } : { status: "done" };
    } catch (error) {
      if (signal.aborted) return { status: "interrupted" };
      return { status: "failed", reason: error instanceof Error ? error.message : String(error) };
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  },
};

/** The block at the target if it can be dug from here, is not protected, and is safe to remove. */
function breakable(bot: Bot, target: string | undefined): Block | null {
  const pos = blockPosOf(bot, target);
  const block = pos && bot.blockAt(pos);
  if (!block || block.boundingBox === "empty" || isProtectedBlock(block.name)) return null;
  return bot.canDigBlock(block) && isSafeToDig(bot, block) ? block : null;
}
