import type { Bot } from "mineflayer";

type InventoryItem = ReturnType<Bot["inventory"]["items"]>[number];

/** Edible but harmful (poison, hunger, nausea or teleporting). */
const AVOID = new Set(["rotten_flesh", "spider_eye", "poisonous_potato", "pufferfish", "chorus_fruit", "suspicious_stew"]);

/** The part of a bot foodValue reads. A real Bot satisfies this. */
export interface FoodRegistry {
  registry: { foodsByName: Record<string, { foodPoints: number; saturation: number } | undefined> };
}

/** Hunger plus saturation restored, or null if the item isn't food worth eating. */
export function foodValue(bot: FoodRegistry, name: string): number | null {
  const food = bot.registry.foodsByName[name];
  return food && !AVOID.has(name) ? food.foodPoints + food.saturation : null;
}

/** Inventory food, best first. */
export function foodsByValue(bot: Bot): InventoryItem[] {
  return bot.inventory
    .items()
    .filter((i) => foodValue(bot, i.name) !== null)
    .sort((a, b) => foodValue(bot, b.name)! - foodValue(bot, a.name)!);
}
