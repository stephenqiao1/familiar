import type { Bot } from "mineflayer";

type InventoryItem = ReturnType<Bot["inventory"]["items"]>[number];
type Named = { name: string };

const WEAPON_KINDS = ["sword", "axe", "pickaxe"];
const MATERIALS = ["wooden", "golden", "stone", "iron", "diamond", "netherite"];

/** Sword > axe > pickaxe, then by material. Null means bare hands. */
export function bestWeapon(bot: Bot): InventoryItem | null {
  return bestWeaponOf(bot.inventory.items());
}

/** The best weapon among `items`, or null. */
export function bestWeaponOf<T extends Named>(items: T[]): T | null {
  let best: T | null = null;
  let bestRank = -1;
  for (const item of items) {
    const [material, kind] = item.name.split("_") as [string, string | undefined];
    const kindRank = kind === undefined ? -1 : WEAPON_KINDS.indexOf(kind);
    if (kindRank < 0) continue;
    const rank = (WEAPON_KINDS.length - kindRank) * 10 + MATERIALS.indexOf(material);
    if (rank > bestRank) [best, bestRank] = [item, rank];
  }
  return best;
}
