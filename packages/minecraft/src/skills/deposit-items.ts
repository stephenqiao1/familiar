import type { Skill } from "@familiar/contracts";
import type { Bot } from "mineflayer";
import pathfinder from "mineflayer-pathfinder";
import { foodsByValue } from "../foods.js";
import type { MinecraftCtx } from "../skill-context.js";
import { walkTo } from "../walk-to.js";
import { bestWeapon } from "../weapons.js";

const { GoalLookAtBlock } = pathfinder.goals;
const FOOD_TO_KEEP = 16;
const isTool = (n: string) => /_(pickaxe|axe|shovel|hoe)$/.test(n) || n === "shears";

type Deposit = { type: number; name: string; count: number };

/** Walks to the base chest and stores everything except tools, the best weapon, torches and up to 16 food. */
export const depositItems: Skill<MinecraftCtx> = {
  name: "deposit_items",
  description: "Store everything in the base chest except tools, best weapon, torches and up to 16 food.",

  canRun(ctx) {
    return toDeposit(ctx.bot).length > 0;
  },

  async run(ctx, _target, signal) {
    const { bot, base } = ctx;
    if (toDeposit(bot).length === 0) {
      ctx.log("deposit_items: nothing to store");
      return { status: "done", reason: "nothing to store" };
    }
    ctx.log(`deposit_items: heading for chest at ${base.chest}`);
    const walk = await walkTo(bot, new GoalLookAtBlock(base.chest, bot.world), signal);
    if (walk.status !== "done") return walk;

    const block = bot.blockAt(base.chest);
    if (!block || block.name !== "chest") return { status: "failed", reason: `no chest at ${base.chest}` };

    const chest = await bot.openContainer(block);
    try {
      for (const item of toDeposit(bot)) {
        if (signal.aborted) return { status: "interrupted" };
        if (!("deposit" in chest)) return { status: "failed", reason: "container is not a chest" };
        try {
          await chest.deposit(item.type, null, item.count);
        } catch (error) {
          return { status: "failed", reason: `could not store ${item.name}: ${error instanceof Error ? error.message : error}` };
        }
      }
    } finally {
      await chest.close();
    }
    ctx.log("deposit_items: chest closed");
    return { status: "done" };
  },
};

/** What to store, by item type: everything minus the keep list. */
function toDeposit(bot: Bot): Deposit[] {
  const keep = new Map<number, number>(); // inventory slot → how many of it to keep
  const weapon = bestWeapon(bot);
  for (const item of bot.inventory.items()) {
    if (isTool(item.name) || item.name === "torch" || item.slot === weapon?.slot) keep.set(item.slot, item.count);
  }
  let foodLeft = FOOD_TO_KEEP;
  for (const food of foodsByValue(bot)) {
    const n = Math.min(food.count, foodLeft);
    keep.set(food.slot, (keep.get(food.slot) ?? 0) + n);
    foodLeft -= n;
  }

  const byType = new Map<number, Deposit>();
  for (const item of bot.inventory.items()) {
    const count = item.count - Math.min(item.count, keep.get(item.slot) ?? 0);
    if (count === 0) continue;
    const entry = byType.get(item.type) ?? { type: item.type, name: item.name, count: 0 };
    entry.count += count;
    byType.set(item.type, entry);
  }
  return [...byType.values()];
}
