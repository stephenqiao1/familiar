import type { Vec3 } from "vec3";
import { airOf, isBurning } from "../body.js";
import { foodValue } from "../foods.js";
import { bestWeaponOf } from "../weapons.js";
import type { EncodableBot, EncodableItem } from "./encodable-bot.js";
import { isEnclosed } from "./scan-enclosure.js";
import { BIG_DROP, isOpen } from "./scan-hazards.js";
import type { MinecraftStateData } from "./state-data.js";

const INVENTORY_SLOTS = 36;
/** A hurt older than this is no longer reported. */
const HURT_MEMORY_MS = 60_000;
const BURNING = new Set(["fire", "soul_fire"]);

/** When the bot was last hurt, and by whom (a target id) if the game said. */
export interface LastHurt {
  at: number;
  by: string | null;
}

export function encodeSelf(bot: EncodableBot, base: Vec3, deaths: number, lastHurt: LastHurt | null = null, now = Date.now()): Omit<MinecraftStateData["self"], "locomotion"> {
  const items = bot.inventory.items();
  const here = bot.blockAt(bot.entity.position.floored());
  const feet = bot.entity.position.floored();
  const { x, y, z } = feet;
  const around = [here?.name, bot.blockAt(feet.offset(0, 1, 0))?.name];
  const inWater = around.includes("water");
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
    air: airOf(bot.entity),
    onFire: isBurning(bot.entity) || BURNING.has(here?.name ?? ""),
    inLava: around.includes("lava"),
    inWater,
    falling: bot.entity.onGround === false && !inWater && dropBelow(bot, feet) >= BIG_DROP,
    lastHurt: lastHurt && now - lastHurt.at <= HURT_MEMORY_MS ? { msAgo: Math.max(0, now - lastHurt.at), by: lastHurt.by } : null,
  };
}

/** How many open blocks lie straight below the feet, counted up to a big drop. */
function dropBelow(bot: EncodableBot, feet: Vec3): number {
  let depth = 0;
  while (depth < BIG_DROP && isOpen(bot, feet.offset(0, -1 - depth, 0))) depth++;
  return depth;
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
