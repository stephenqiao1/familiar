import type { Bot } from "mineflayer";
import type { Vec3 } from "vec3";
import pathfinderPkg from "mineflayer-pathfinder";
import { isProtectedBlock } from "../protected.js";
import { isDangerousBlock, isSafeToDig, touchesHurt } from "../safety.js";

const { Movements } = pathfinderPkg;
type Rules = InstanceType<typeof Movements>;

/** Stepping onto a spot being avoided costs this much (the pathfinder treats over 100 as impossible). */
const AVOID_COST = 60;
/** Stepping where the bot would stand on or in a block it knows hurts is not allowed; brushing past one costs this much. */
const HURT_COST = { in: 200, beside: 40 };

/** What a step onto `pos` costs because of blocks the bot knows hurt (innate or learned; asked afresh each time). */
function hurtCost(bot: Bot, pos: Vec3): number {
  const hurts = (at: Vec3) => isDangerousBlock(bot.blockAt(at)?.name ?? "", bot);
  if (hurts(pos) || hurts(pos.offset(0, 1, 0)) || hurts(pos.offset(0, -1, 0))) return HURT_COST.in;
  return touchesHurt(bot, pos) ? HURT_COST.beside : 0;
}

/** The two sets of pathing rules the walk pattern chooses between. */
export interface RuleSets {
  /** May dig its way through, never parkour, never breaks what safety.ts or protected.ts forbids. */
  normal: Rules;
  /** The same, but no digging and no placing: used near the base and when caution is high. */
  careful: Rules;
}

/**
 * Builds both rule sets. Neither ever digs a door (the controller opens those) or a protected
 * block, steps on or into a block the bot knows hurts, and both steer round spots `avoid` marks.
 * (The pathfinder by itself only keeps out of fire, lava and cobwebs.)
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
    // The pathfinder hands over a block with no position when it looks past the loaded world: nothing is known there.
    rules.exclusionAreasStep = [(block) => (block.position ? (avoid(block.position) ? AVOID_COST : 0) + hurtCost(bot, block.position) : 0)];
    for (const block of bot.registry.blocksArray) {
      if (isProtectedBlock(block.name) || block.name.endsWith("_door")) rules.blocksCantBreak.add(block.id);
    }
    return rules;
  };
  return { normal: build(false), careful: build(true) };
}
