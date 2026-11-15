import type { Bot } from "mineflayer";
import { carriedItem, reasonOf } from "./aim.js";
import { primitive } from "./primitive.js";

type InventoryItem = ReturnType<Bot["inventory"]["items"]>[number];

/** Puts an inventory item in the hand. */
export async function doEquip(bot: Bot, item: InventoryItem): Promise<void> {
  await bot.equip(item, "hand");
}

/** The next different item after the one in hand, in inventory order (wrapping round), or null. */
export function nextItem(bot: Bot): InventoryItem | null {
  const items = bot.inventory.items();
  const held = bot.heldItem?.name ?? null;
  const at = items.findIndex((i) => i.name === held);
  const order = [...items.slice(at + 1), ...items.slice(0, Math.max(0, at))];
  return order.find((i) => i.name !== held) ?? null;
}

/** Puts a carried item in the hand: a named one, or the next one along. */
export const equip = primitive({
  name: "equip",
  description: "Hold a carried item: item:<name>, or with no target the next item along.",
  parts: ["hands"],
  expects: ["held"],

  canRun(ctx, target) {
    const item = target === undefined ? nextItem(ctx.bot) : carriedItem(ctx.bot, target);
    return item !== null && item.name !== ctx.bot.heldItem?.name;
  },

  async run(ctx, target) {
    const item = target === undefined ? nextItem(ctx.bot) : carriedItem(ctx.bot, target);
    if (!item) return { status: "failed", reason: target === undefined ? "nothing else to hold" : `not carrying "${target}"` };
    try {
      await doEquip(ctx.bot, item);
      return { status: "done" };
    } catch (error) {
      return { status: "failed", reason: reasonOf(error) };
    }
  },
});
