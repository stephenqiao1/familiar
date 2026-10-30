import type { Skill } from "@familiar/contracts";
import type { Bot } from "mineflayer";
import pathfinder from "mineflayer-pathfinder";
import { canHarvestBlock, digSafely } from "../dig.js";
import { collectDrops } from "../drops.js";
import type { Block } from "../mc-types.js";
import { resolveTarget } from "../resolve-target.js";
import type { MinecraftCtx } from "../skill-context.js";
import { parseTarget } from "../target.js";
import { walkTo } from "../walk-to.js";

const { GoalLookAtBlock } = pathfinder.goals;
const DEFAULT_TARGET = "nearest:stone";

/** Walks to a block, digs it with the right tool, and picks up what drops. */
export const mineBlock: Skill<MinecraftCtx> = {
  name: "mine_block",
  description: "Mine one block (default nearest:stone) with the right tool and pick up the drops.",

  canRun(ctx, target) {
    const block = resolveBlock(ctx.bot, target);
    return block !== null && canHarvestBlock(ctx.bot, block);
  },

  async run(ctx, target, signal) {
    const { bot } = ctx;
    const block = resolveBlock(bot, target);
    if (!block) return { status: "failed", reason: `no block found for ${target ?? DEFAULT_TARGET}` };
    ctx.log(`mine_block: going to ${block.name} at ${block.position}`);

    const walk = await walkTo(bot, new GoalLookAtBlock(block.position, bot.world), signal);
    if (walk.status !== "done") return walk;

    try {
      // Re-read the block: it may have changed while walking.
      const current = bot.blockAt(block.position);
      if (!current || current.name !== block.name) return { status: "failed", reason: "block changed before digging" };

      const outcome = await digSafely(bot, current, signal);
      if (outcome !== "dug") return { status: "failed", reason: outcome };

      await collectDrops(bot, current.position, signal);
      return { status: "done" };
    } catch (error) {
      if (signal.aborted) return { status: "interrupted" };
      throw error;
    }
  },
};

function resolveBlock(bot: Bot, target: string | undefined): Block | null {
  const parsed = parseTarget(target ?? DEFAULT_TARGET);
  const resolved = parsed && resolveTarget(bot, parsed);
  if (resolved?.kind === "block") return resolved.block;
  if (resolved?.kind === "position") return bot.blockAt(resolved.position.floored());
  return null;
}
