import type { ItemWant, Skill } from "@familiar/contracts";
import pathfinder from "mineflayer-pathfinder";
import type { Block } from "../mc-types.js";
import type { MinecraftCtx } from "../skill-context.js";
import { walkTo } from "../walk-to.js";
import { countByName } from "../encode/encode-self.js";
import { posId } from "../encode/scan-blocks.js";
import { chosenContainer, containerAt, stillWanted } from "./storage.js";

const { GoalLookAtBlock } = pathfinder.goals;

/**
 * Takes from a chest what the current goal wants the bot to carry (the planner decides; this skill
 * only fetches). Takes only what is still missing. With no target it goes to the nearest chest it
 * remembers holding something wanted, else the base chest. Remembers what the chest held after.
 */
export const takeItems: Skill<MinecraftCtx> = {
  name: "take_items",
  description: "Take from a chest the items the current goal wants carried. Target: the chest (default: one known to hold them, else base).",

  canRun(ctx, target) {
    const missing = stillWanted(ctx.wants(), countByName(ctx.bot.inventory.items()));
    if (missing.length === 0 || ctx.bot.inventory.emptySlotCount() === 0) return false;
    const chest = target === undefined ? pickChest(ctx, missing) : containerAt(ctx.bot, target);
    if (!chest) return false;
    // Skip a chest it remembers holding none of it.
    const known = ctx.chests.recall(posId(chest.position));
    return !known || holdsAny(known.contents, missing);
  },

  async run(ctx, target, signal) {
    const { bot } = ctx;
    const missing = stillWanted(ctx.wants(), countByName(bot.inventory.items()));
    if (missing.length === 0) return { status: "done", reason: "already carrying what the goal wants" };
    const chest = target === undefined ? pickChest(ctx, missing) : containerAt(bot, target);
    if (!chest) return { status: "failed", reason: `no chest at ${target ?? "base"}` };
    ctx.log(`take_items: heading for ${chest.name} at ${chest.position} for ${describe(missing)}`);
    const walk = await walkTo(bot, new GoalLookAtBlock(chest.position, bot.world), signal);
    if (walk.status !== "done") return walk;

    const block = bot.blockAt(chest.position);
    if (!block || block.name !== chest.name) return { status: "failed", reason: `no chest at ${chest.position}` };
    const window = await bot.openContainer(block);
    const taken: ItemWant[] = [];
    try {
      if (!("withdraw" in window)) return { status: "failed", reason: "container cannot be taken from" };
      for (const want of missing) {
        if (signal.aborted) return { status: "interrupted" };
        const stacks = window.containerItems().filter((i) => i.name === want.item);
        const count = Math.min(want.count, stacks.reduce((sum, i) => sum + i.count, 0));
        if (count === 0) continue;
        try {
          await window.withdraw(stacks[0]!.type, null, count);
          taken.push({ item: want.item, count });
        } catch (error) {
          // Withdraw throws when the inventory is full: keep what was taken.
          ctx.log(`take_items: stopped at ${want.item}: ${error instanceof Error ? error.message : error}`);
          break;
        }
      }
      ctx.chests.remember(posId(chest.position), countByName(window.containerItems()), Date.now());
    } finally {
      await window.close();
    }
    const short = stillWanted(ctx.wants(), countByName(bot.inventory.items()));
    ctx.log(`take_items: took ${taken.length ? describe(taken) : "nothing"}`);
    return short.length ? { status: "done", reason: `chest lacked ${describe(short)}` } : { status: "done" };
  },
};

/** The nearest remembered chest holding something wanted, else the base chest. */
function pickChest(ctx: MinecraftCtx, missing: ItemWant[]): Block | null {
  const me = ctx.bot.entity.position;
  const known = Object.entries(ctx.chests.entries())
    .filter(([, record]) => holdsAny(record.contents, missing))
    .map(([id]) => containerAt(ctx.bot, id))
    .filter((block): block is Block => block !== null)
    .sort((a, b) => a.position.distanceTo(me) - b.position.distanceTo(me));
  return known[0] ?? chosenContainer(ctx, undefined);
}

function holdsAny(contents: Record<string, number>, wants: ItemWant[]): boolean {
  return wants.some((w) => (contents[w.item] ?? 0) > 0);
}

function describe(wants: ItemWant[]): string {
  return wants.map((w) => `${w.count} ${w.item}`).join(", ");
}
