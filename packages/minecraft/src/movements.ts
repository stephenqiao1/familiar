import type { Bot } from "mineflayer";
import { Movements } from "mineflayer-pathfinder";
import { isProtectedBlock } from "./protected.js";
import { isSafeToDig } from "./safety.js";

/**
 * Default pathing rules: may dig through blocks, but never parkour (sprint-jumps across gaps into
 * unknown blocks), and never breaks a block that fails the safety check or belongs to the base
 * (chests, beds, crafting tables...).
 */
export function createDefaultMovements(bot: Bot): Movements {
  const movements = new Movements(bot);
  movements.canDig = true;
  movements.allowParkour = false;
  movements.exclusionAreasBreak = [(block) => (isSafeToDig(bot, block) ? 0 : Infinity)];
  for (const block of bot.registry.blocksArray) {
    if (isProtectedBlock(block.name)) movements.blocksCantBreak.add(block.id);
  }
  return movements;
}
