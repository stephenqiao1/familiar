import type { EncodableBot } from "./encodable-bot.js";
import { posId, scanBlocks } from "./scan-blocks.js";
import { DEFAULT_LIMIT } from "./scan-mobs.js";
import type { Nearby } from "./state-data.js";

/** How far off a useful block is sensed. */
export const USEFUL_BLOCK_RADIUS = 16;
/** Blocks that store items. */
export const CONTAINERS = new Set(["chest", "trapped_chest", "barrel"]);
/** Each crop's top growth stage (its "age" when ripe), from minecraft-data. */
const RIPE_AGE: Record<string, number> = {
  wheat: 7,
  carrots: 7,
  potatoes: 7,
  beetroots: 3,
  nether_wart: 3,
  cocoa: 2,
  sweet_berry_bush: 3,
};

/** The kinds of block the scan lists. */
export const isUsefulBlock = (name: string) => CONTAINERS.has(name) || name in RIPE_AGE || name === "bell";

/** Chests, ripe crops and bells (a sign of a village) within 16 blocks, the nearest `limit`. */
export function scanUsefulBlocks(bot: EncodableBot, limit = DEFAULT_LIMIT): Nearby[] {
  const me = bot.entity.position;
  const candidates = scanBlocks(bot, isUsefulBlock, USEFUL_BLOCK_RADIUS, limit * 4);
  const found: Nearby[] = [];
  for (const pos of candidates) {
    const block = bot.blockAt(pos);
    if (!block || !(block.name in RIPE_AGE ? isRipe(block.name, block.getProperties?.()) : true)) continue;
    found.push({ id: posId(pos), type: block.name, dist: Math.round(pos.distanceTo(me)) });
    if (found.length === limit) break;
  }
  return found;
}

function isRipe(crop: string, properties: Record<string, unknown> | undefined): boolean {
  return properties?.age === RIPE_AGE[crop];
}
