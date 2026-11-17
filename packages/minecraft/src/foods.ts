import type { Bot } from "mineflayer";

type InventoryItem = ReturnType<Bot["inventory"]["items"]>[number];

/** The foods a bot is born knowing are bad for it (poison, hunger, nausea or teleporting), unless its settings say otherwise. */
export const INNATE_BAD_FOODS = ["rotten_flesh", "spider_eye", "poisonous_potato", "pufferfish", "chorus_fruit", "suspicious_stew"];
const BORN_KNOWING = new Set(INNATE_BAD_FOODS);
/** Each bot's own knowledge of which foods are bad (innate and learned), given by `setKnownBadFoods`. */
const known = new WeakMap<object, (food: string) => boolean>();

/** Tells the food helpers what this bot knows to be bad to eat. (This file only looks things up; it reads no files.) */
export function setKnownBadFoods(bot: object, knowsBad: (food: string) => boolean): void {
  known.set(bot, knowsBad);
}

/** The part of a bot the food helpers read. A real Bot satisfies this. */
export interface FoodRegistry {
  registry: { foodsByName: Record<string, { foodPoints: number; saturation: number } | undefined> };
}

/** Whether the bot knows a food to be bad (a bot never told otherwise knows the innate list). */
export function isBadFood(bot: object, name: string): boolean {
  const knowsBad = known.get(bot);
  return knowsBad ? knowsBad(name) : BORN_KNOWING.has(name);
}

/** Whether an item can be eaten at all. */
export function isFood(bot: FoodRegistry, name: string): boolean {
  return bot.registry.foodsByName[name] !== undefined;
}

/** Hunger plus saturation restored, or null if the item isn't food worth eating (not food, or known to be bad). */
export function foodValue(bot: FoodRegistry, name: string): number | null {
  const food = bot.registry.foodsByName[name];
  return food && !isBadFood(bot, name) ? food.foodPoints + food.saturation : null;
}

/** Inventory food that is not known to be bad, best first. */
export function foodsByValue(bot: Bot): InventoryItem[] {
  return bot.inventory
    .items()
    .filter((i) => foodValue(bot, i.name) !== null)
    .sort((a, b) => foodValue(bot, b.name)! - foodValue(bot, a.name)!);
}

/** Inventory food that is known to be bad: only for when there is nothing else and the bot is starving. */
export function badFoods(bot: Bot): InventoryItem[] {
  return bot.inventory.items().filter((i) => isFood(bot, i.name) && isBadFood(bot, i.name));
}
