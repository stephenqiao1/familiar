import type { EncodableBot } from "./encodable-bot.js";
import { posId, scanBlocks } from "./scan-blocks.js";
import type { Nearby } from "./state-data.js";

const RADIUS = 16;
const LIMIT = 10;

/** Up to 10 nearest *_ore blocks within 16 blocks. */
export function scanOres(bot: EncodableBot): Nearby[] {
  const me = bot.entity.position;
  return scanBlocks(bot, (name) => name.endsWith("_ore"), RADIUS, LIMIT).map((pos) => ({
    id: posId(pos),
    type: bot.blockAt(pos)?.name ?? "ore",
    dist: Math.round(pos.distanceTo(me)),
  }));
}
