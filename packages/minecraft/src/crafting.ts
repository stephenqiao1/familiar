import type { Bot } from "mineflayer";
import type { Block } from "./mc-types.js";

/** Total count of inventory items whose name passes `test`. */
export function countItems(bot: Bot, test: (name: string) => boolean): number {
  return bot.inventory.items().reduce((sum, i) => (test(i.name) ? sum + i.count : sum), 0);
}

/**
 * Crafts one batch of `name` from the inventory. Pass a table for 3×3 recipes, and `using` to pick
 * the recipe that consumes that ingredient (e.g. "birch_planks"). Throws if no recipe fits.
 */
export async function craftOnce(bot: Bot, name: string, table: Block | null = null, using?: string): Promise<void> {
  const item = bot.registry.itemsByName[name];
  if (!item) throw new Error(`unknown item ${name}`);
  const ingredient = using === undefined ? undefined : bot.registry.itemsByName[using]?.id;
  const recipe = bot
    .recipesFor(item.id, null, 1, table)
    .find((r) => ingredient === undefined || r.delta.some((d) => d.id === ingredient && d.count < 0));
  if (!recipe) throw new Error(`no recipe for ${name}${using ? ` from ${using}` : ""} with the current inventory`);
  await bot.craft(recipe, 1, table ?? undefined);
}
