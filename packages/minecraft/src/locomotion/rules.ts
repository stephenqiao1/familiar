import type { Bot } from "mineflayer";
import pathfinderPkg from "mineflayer-pathfinder";
import { isProtectedBlock } from "../protected.js";
import { isSafeToDig } from "../safety.js";

const { Movements } = pathfinderPkg;
type Rules = InstanceType<typeof Movements>;

/** Stepping onto a spot being avoided costs this much (the pathfinder treats over 100 as impossible). */
const AVOID_COST = 60;

/** The two sets of pathing rules the walk pattern chooses between. */
export interface RuleSets {
  /** May dig its way through, never parkour, never breaks what safety.ts or protected.ts forbids. */
  normal: Rules;
  /** The same, but no digging and no placing: used near the base and when caution is high. */
  careful: Rules;
}

/**
 * Builds both rule sets. Neither ever digs a door (the controller opens those) or a protected
 * block, and both steer round spots `avoid` marks.
 */
export function createRules(bot: Bot, avoid: (pos: { x: number; y: number; z: number }) => boolean): RuleSets {
  const build = (careful: boolean): Rules => {
    const rules = new Movements(bot);
    rules.allowParkour = false;
    rules.canDig = !careful;
    if (careful) {
      rules.allow1by1towers = false;
      rules.scafoldingBlocks = [];
    }
    rules.exclusionAreasBreak = [(block) => (isSafeToDig(bot, block) ? 0 : Infinity)];
    rules.exclusionAreasStep = [(block) => (avoid(block.position) ? AVOID_COST : 0)];
    for (const block of bot.registry.blocksArray) {
      if (isProtectedBlock(block.name) || block.name.endsWith("_door")) rules.blocksCantBreak.add(block.id);
    }
    return rules;
  };
  return { normal: build(false), careful: build(true) };
}
