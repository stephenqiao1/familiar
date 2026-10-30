import type { Vec3 } from "vec3";
import { foodValue } from "../foods.js";
import { bestWeaponOf } from "../weapons.js";
import type { EncodableBot, EncodableItem } from "./encodable-bot.js";
import type { MinecraftStateData } from "./state-data.js";

const INVENTORY_SLOTS = 36;
const PICKAXE_TIERS = ["wooden", "golden", "stone", "iron", "diamond", "netherite"];

export function encodeSelf(bot: EncodableBot, base: Vec3): MinecraftStateData["self"] {
  const items = bot.inventory.items();
  return {
    health: Math.round(bot.health),
    food: Math.round(bot.food),
    heldItem: bot.heldItem?.name ?? null,
    bestWeapon: bestWeaponOf(items)?.name ?? null,
    pickaxeDurabilityPct: pickaxeDurability(items),
    inventoryFullPct: Math.round((items.length / INVENTORY_SLOTS) * 100),
    torches: count(items, (name) => name === "torch"),
    foodItems: count(items, (name) => foodValue(bot, name) !== null),
    distanceToBase: Math.round(bot.entity.position.distanceTo(base)),
  };
}

/** Durability left on the best pickaxe carried, as a whole percent; null if none. */
function pickaxeDurability(items: EncodableItem[]): number | null {
  const pickaxes = items.filter((i) => i.name.endsWith("_pickaxe"));
  if (pickaxes.length === 0) return null;
  const tier = (i: EncodableItem) => PICKAXE_TIERS.indexOf(i.name.split("_")[0]!);
  const best = pickaxes.reduce((a, b) => (tier(b) > tier(a) ? b : a));
  if (!best.maxDurability) return 100;
  return Math.round(((best.maxDurability - best.durabilityUsed) / best.maxDurability) * 100);
}

function count(items: EncodableItem[], test: (name: string) => boolean): number {
  return items.reduce((sum, i) => (test(i.name) ? sum + i.count : sum), 0);
}
