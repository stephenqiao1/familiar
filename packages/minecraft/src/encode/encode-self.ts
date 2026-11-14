import type { Vec3 } from "vec3";
import { foodValue } from "../foods.js";
import { bestWeaponOf } from "../weapons.js";
import type { EncodableBot, EncodableItem } from "./encodable-bot.js";
import { isEnclosed } from "./scan-enclosure.js";
import type { MinecraftStateData } from "./state-data.js";

const INVENTORY_SLOTS = 36;

export function encodeSelf(bot: EncodableBot, base: Vec3, deaths: number): MinecraftStateData["self"] {
  const items = bot.inventory.items();
  const here = bot.blockAt(bot.entity.position.floored());
  const { x, y, z } = bot.entity.position.floored();
  return {
    position: { x, y, z },
    dimension: bot.game.dimension,
    health: Math.round(bot.health),
    food: Math.round(bot.food),
    heldItem: bot.heldItem?.name ?? null,
    bestWeapon: bestWeaponOf(items)?.name ?? null,
    inventoryFullPct: Math.round((items.length / INVENTORY_SLOTS) * 100),
    foodItems: count(items, (name) => foodValue(bot, name) !== null),
    inventory: countByName(items),
    distanceToBase: Math.round(bot.entity.position.distanceTo(base)),
    biome: (here?.biome && (bot.registry.biomes?.[here.biome.id]?.name || here.biome.name)) || null,
    skyLight: here?.skyLight ?? 0,
    enclosed: isEnclosed(bot),
    asleep: bot.isSleeping,
    deaths,
  };
}

/** Item name → total count, summed across stacks. */
export function countByName(items: { name: string; count: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[i.name] = (out[i.name] ?? 0) + i.count;
  return out;
}

function count(items: EncodableItem[], test: (name: string) => boolean): number {
  return items.reduce((sum, i) => (test(i.name) ? sum + i.count : sum), 0);
}
