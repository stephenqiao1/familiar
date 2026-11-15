import type { Bot } from "mineflayer";
import { carriedItem, reasonOf } from "./aim.js";
import { primitive } from "./primitive.js";

type InventoryItem = ReturnType<Bot["inventory"]["items"]>[number];

/** Drops `count` of an item on the ground in front of the bot; null drops the whole stack. */
export async function doDrop(bot: Bot, item: InventoryItem, count: number | null): Promise<void> {
  if (count === null) await bot.tossStack(item);
  else await bot.toss(item.type, null, count);
}

/** Drops what is in the hand: one of it, or with a target the whole stack. */
export const dropItem = primitive({
  name: "drop_item",
  description: "Drop one of the item in hand; with target held (or item:<name>) drop that whole stack.",
  parts: ["hands"],
  expects: ["lost", "drops"],
  settleMs: 300,

  canRun(ctx, target) {
    return (target === undefined ? ctx.bot.heldItem : carriedItem(ctx.bot, target)) !== null;
  },

  async run(ctx, target) {
    const item = target === undefined ? ctx.bot.heldItem : carriedItem(ctx.bot, target);
    if (!item) return { status: "failed", reason: target === undefined ? "nothing in hand" : `not carrying "${target}"` };
    try {
      await doDrop(ctx.bot, item, target === undefined ? 1 : null);
      return { status: "done" };
    } catch (error) {
      return { status: "failed", reason: reasonOf(error) };
    }
  },
});
