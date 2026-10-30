import type { Bot } from "mineflayer";
import type { Block } from "./mc-types.js";
import { isProtectedBlock } from "./protected.js";
import { isSafeToDig } from "./safety.js";

export type DigOutcome = "dug" | "unsafe" | "protected" | "no_tool" | "not_diggable";

/** True if the bot could break `block` and get its drop: diggable, not protected, and a tool it carries (or bare hands) can harvest it. */
export function canHarvestBlock(bot: Bot, block: Block): boolean {
  if (!block.diggable || block.boundingBox === "empty" || isProtectedBlock(block.name)) return false;
  return block.canHarvest(bot.pathfinder.bestHarvestTool(block)?.type ?? null);
}

/**
 * Checks safety, equips the best tool, and breaks the block. Rejects with `signal.reason` if
 * aborted mid-dig. Every skill that breaks a block goes through here.
 */
export async function digSafely(bot: Bot, block: Block, signal: AbortSignal): Promise<DigOutcome> {
  signal.throwIfAborted();
  if (!block.diggable || block.boundingBox === "empty") return "not_diggable";
  if (isProtectedBlock(block.name)) return "protected";
  if (!isSafeToDig(bot, block)) return "unsafe";

  const tool = bot.pathfinder.bestHarvestTool(block);
  if (!block.canHarvest(tool?.type ?? null)) return "no_tool";
  if (tool) await bot.equip(tool, "hand");

  const onAbort = () => bot.stopDigging();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    await bot.dig(block, true);
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
  return "dug";
}
