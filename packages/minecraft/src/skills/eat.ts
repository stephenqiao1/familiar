import type { Skill } from "@familiar/contracts";
import type { Bot } from "mineflayer";
import { badFoods, foodsByValue } from "../foods.js";
import { doEquip } from "../primitives/equip.js";
import { doUseItem } from "../primitives/use-item.js";
import type { MinecraftCtx } from "../skill-context.js";

const FULL = 20;
/** At or below this food level the bot is starving: it will eat what it knows to be bad if it has nothing else. */
const STARVING = 6;

/** How full to eat to: a "level:<n>" target (enough for what asked), or completely full. */
function enough(target: string | undefined): number {
  const level = /^level:(\d+)$/.exec(target ?? "")?.[1];
  return level === undefined ? FULL : Math.min(FULL, Math.max(1, Number(level)));
}

/** What to eat next: the best food not known to be bad; a known-bad one only when starving with nothing else. */
function nextFood(bot: Bot) {
  return foodsByValue(bot)[0] ?? (bot.food <= STARVING ? badFoods(bot)[0] : undefined);
}

/**
 * Eats the best food in the inventory until full, or until the food bar reaches the level asked
 * for ("level:18": enough to heal). Food known to be bad is eaten only when starving and nothing
 * else is carried. Each meal is noted, so the bot can learn which foods make it ill.
 */
export const eat: Skill<MinecraftCtx> = {
  name: "eat",
  description: "Eat the best food in the inventory until full (or to level:<n>).",
  // Eating is all in the hands, so the head and legs are free.
  parts: ["hands"],

  canRun(ctx, target) {
    return ctx.bot.food < enough(target) && nextFood(ctx.bot) !== undefined;
  },

  async run(ctx, target, signal) {
    const { bot } = ctx;
    const until = enough(target);
    const ate: string[] = [];
    while (bot.food < until) {
      if (signal.aborted) return { status: "interrupted", changes: { ate: ate.join(", ") } };
      const food = nextFood(bot);
      if (!food) break;

      ctx.log(`eat: eating ${food.name} (food ${bot.food}/${FULL}, until ${until})`);
      await doEquip(bot, food);
      // Noted as the bite begins as well as when it ends: the illness a bad food brings arrives with
      // the last mouthful, before this skill hears that the meal is over.
      ctx.gut.ate(food.name, Date.now());
      // Holds the food in use until it is eaten, and always lets go (also when stopped mid-bite).
      const eaten = await doUseItem(bot, signal).catch(() => false);
      if (signal.aborted) return { status: "interrupted", changes: { ate: ate.join(", ") } };
      if (!eaten) return { status: "failed", reason: `could not eat ${food.name}` };
      ate.push(food.name);
      ctx.gut.ate(food.name, Date.now());
    }
    return { status: "done", changes: { ate: ate.join(", "), until } };
  },
};
