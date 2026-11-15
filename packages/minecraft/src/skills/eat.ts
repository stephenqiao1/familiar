import type { Skill } from "@familiar/contracts";
import { foodsByValue } from "../foods.js";
import { doEquip } from "../primitives/equip.js";
import { doUseItem } from "../primitives/use-item.js";
import type { MinecraftCtx } from "../skill-context.js";

const FULL = 20;

/** Eats the best food in the inventory until full or out of food. */
export const eat: Skill<MinecraftCtx> = {
  name: "eat",
  description: "Eat the best food in the inventory until full.",
  // Eating is all in the hands, so the head and legs are free.
  parts: ["hands"],

  canRun(ctx) {
    return ctx.bot.food < FULL && foodsByValue(ctx.bot).length > 0;
  },

  async run(ctx, _target, signal) {
    const { bot } = ctx;
    while (bot.food < FULL) {
      if (signal.aborted) return { status: "interrupted" };
      const [food] = foodsByValue(bot);
      if (!food) break;

      ctx.log(`eat: eating ${food.name} (food ${bot.food}/${FULL})`);
      await doEquip(bot, food);
      // Holds the food in use until it is eaten, and always lets go (also when stopped mid-bite).
      const eaten = await doUseItem(bot, signal).catch(() => false);
      if (signal.aborted) return { status: "interrupted" };
      if (!eaten) return { status: "failed", reason: `could not eat ${food.name}` };
    }
    return { status: "done" };
  },
};
