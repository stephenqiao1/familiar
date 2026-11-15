import type { Skill } from "@familiar/contracts";
import { sleepFor } from "../abort.js";
import type { MinecraftCtx } from "../skill-context.js";
import { entityOf, withinReach } from "./aim.js";

const HOLD_MS = 250;

/** Uses the item in hand: on an entity within reach if one is given, otherwise on its own. */
export const useItem: Skill<MinecraftCtx> = {
  name: "use_item",
  description: "Use the item in hand, on entity:<id> within reach if given.",
  primitive: true,

  canRun(ctx, target) {
    if (ctx.bot.heldItem === null) return false;
    if (target === undefined) return true;
    const entity = entityOf(ctx.bot, target);
    return entity !== null && withinReach(ctx.bot, entity.position);
  },

  async run(ctx, target, signal) {
    const { bot } = ctx;
    const entity = entityOf(bot, target);
    try {
      if (entity) bot.useOn(entity);
      else bot.activateItem();
      await sleepFor(HOLD_MS, signal);
      return { status: "done" };
    } catch (error) {
      if (signal.aborted) {
        bot.deactivateItem();
        return { status: "interrupted" };
      }
      throw error;
    }
  },
};
