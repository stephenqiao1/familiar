import type { Bot } from "mineflayer";
import type { Block, Entity } from "../mc-types.js";
import { AHEAD, blockOf, entityOf, withinReach } from "./aim.js";
import { doLookAt } from "./look-at.js";
import { primitive } from "./primitive.js";

/**
 * Uses the held item, or an empty hand, on a block: opens a door, presses a button, gets into a
 * bed (which waits until the bot is lying in it).
 */
export async function doUseOnBlock(bot: Bot, block: Block): Promise<void> {
  if (bot.isABed(block)) return bot.sleep(block);
  await doLookAt(bot, block.position.offset(0.5, 0.5, 0.5));
  await bot.activateBlock(block);
}

/** Uses the held item, or an empty hand, on an entity (feed or shear an animal, trade). */
export async function doUseOnEntity(bot: Bot, entity: Entity): Promise<void> {
  await doLookAt(bot, entity.position.offset(0, entity.height * 0.8, 0));
  await bot.activateEntity(entity);
}

/** Gets out of bed. */
export async function doWake(bot: Bot): Promise<void> {
  await bot.wake();
}

/** Uses the held item, or an empty hand, on a block or entity within reach. */
export const useOn = primitive({
  name: "use_on",
  description: "Use the held item (or an empty hand) on a block or entity within reach: a door, button, bed, animal (default: ahead).",
  parts: ["hands", "head"],
  standing: true,
  expects: [],
  settleMs: 300,
  defaultTarget: () => AHEAD,

  canRun(ctx, target) {
    return thingOf(ctx.bot, target) !== null;
  },

  async run(ctx, target, signal) {
    const thing = thingOf(ctx.bot, target);
    if (!thing) return { status: "failed", reason: "nothing within reach there" };
    if (signal.aborted) return { status: "interrupted" };
    if ("entity" in thing) await doUseOnEntity(ctx.bot, thing.entity);
    else await doUseOnBlock(ctx.bot, thing.block);
    return { status: "done" };
  },
});

function thingOf(bot: Bot, target: string | undefined): { entity: Entity } | { block: Block } | null {
  const entity = entityOf(bot, target ?? AHEAD);
  if (entity) return entity.id !== bot.entity.id && withinReach(bot, entity.position.offset(0, entity.height * 0.5, 0)) ? { entity } : null;
  const block = blockOf(bot, target ?? AHEAD);
  return block && withinReach(bot, block.position.offset(0.5, 0.5, 0.5)) ? { block } : null;
}
