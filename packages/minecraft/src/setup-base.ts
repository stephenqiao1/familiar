import type { Bot } from "mineflayer";
import type { Vec3 } from "vec3";
import type { Base } from "./base.js";
import { DEFAULT_BASE_FILE, loadBase, saveBase } from "./base-store.js";
import { findBlockNear } from "./find-nearby.js";
import { placeNearby } from "./placement.js";

const SEARCH_RADIUS = 16;
const isChest = (name: string) => name === "chest";
const isBed = (name: string) => name.endsWith("_bed");

/**
 * Finds the agent's chest and bed: the saved base if both blocks are still there, else ones within
 * 16 blocks of spawn, else places them from inventory. Saves the result. Throws if it can't.
 */
export async function setupBase(bot: Bot, file = DEFAULT_BASE_FILE): Promise<Base> {
  await bot.waitForChunksToLoad();
  const saved = await loadBase(file);
  if (saved && blockIs(bot, saved.chest, isChest) && blockIs(bot, saved.bed, isBed)) return saved;

  const chest = findNearSpawn(bot, isChest) ?? (await placeFromInventory(bot, isChest, "chest"));
  const bed = findNearSpawn(bot, isBed) ?? (await placeFromInventory(bot, isBed, "bed"));
  const base = { chest, bed };
  await saveBase(base, file);
  return base;
}

function blockIs(bot: Bot, pos: Vec3, test: (name: string) => boolean): boolean {
  const block = bot.blockAt(pos);
  return block !== null && test(block.name);
}

function findNearSpawn(bot: Bot, test: (name: string) => boolean): Vec3 | null {
  return findBlockNear(bot, test, SEARCH_RADIUS, bot.spawnPoint ?? bot.entity.position);
}

async function placeFromInventory(bot: Bot, test: (name: string) => boolean, what: string): Promise<Vec3> {
  const item = bot.inventory.items().find((i) => test(i.name));
  if (!item) {
    throw new Error(`No ${what} within ${SEARCH_RADIUS} blocks of spawn and none in inventory to place.`);
  }
  let pos: Vec3;
  try {
    pos = await placeNearby(bot, item, what === "bed");
  } catch (error) {
    throw new Error(`No ${what} near spawn, and placing one failed: ${error instanceof Error ? error.message : error}`);
  }
  if (!blockIs(bot, pos, test)) throw new Error(`Tried to place a ${what} at ${pos} but it isn't there.`);
  return pos;
}
