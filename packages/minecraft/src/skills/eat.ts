import type { Skill } from "@familiar/contracts";
import type { Bot } from "mineflayer";
import { foodsByValue } from "../foods.js";
import type { MinecraftCtx } from "../skill-context.js";

const FULL = 20;

/** Eats the best food in the inventory until full or out of food. */
export const eat: Skill<MinecraftCtx> = {
  name: "eat",
  description: "Eat the best food in the inventory until full.",

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
      await bot.equip(food, "hand");
      const finished = await consumeUnlessAborted(bot, signal);
      if (!finished) return { status: "interrupted" };
    }
    return { status: "done" };
  },
};

/** Eats one item. Stops chewing and returns false if the signal fires first. */
async function consumeUnlessAborted(bot: Bot, signal: AbortSignal): Promise<boolean> {
  let onAbort = () => {};
  const aborted = new Promise<false>((resolve) => {
    onAbort = () => {
      bot.deactivateItem();
      resolve(false);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const eating = bot.consume().then(() => true as const);
  // If we stop chewing, the abandoned consume() may still reject later; don't let that crash the process.
  eating.catch(() => {});
  try {
    return await Promise.race([eating, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
