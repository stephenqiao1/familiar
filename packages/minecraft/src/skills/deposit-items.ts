import type { Skill } from "@familiar/contracts";
import { doClose } from "../primitives/close.js";
import { doMoveItem } from "../primitives/move-item.js";
import { doOpen } from "../primitives/open.js";
import { withJourney } from "../locomotion/index.js";
import type { MinecraftCtx } from "../skill-context.js";
import { countByName } from "../encode/encode-self.js";
import { posId } from "../encode/scan-blocks.js";
import { chosenContainer } from "./storage.js";


type Deposit = { type: number; name: string; count: number };

/**
 * Stores in a chest everything the current goal doesn't want carried (the planner decides what to
 * keep; this skill only stores). Won't run when the goal lists nothing to carry, so the bot never
 * empties its pockets without a plan. Remembers what the chest held after.
 */
export const depositItems: Skill<MinecraftCtx> = {
  name: "deposit_items",
  description: "Store in a chest everything the current goal doesn't want carried. Target: the chest (default: base chest).",

  canRun(ctx, target) {
    return chosenContainer(ctx, target) !== null && toDeposit(ctx).length > 0;
  },

  async run(ctx, target, signal) {
    const { bot } = ctx;
    if (toDeposit(ctx).length === 0) return { status: "done", reason: "nothing to store" };
    const chest = chosenContainer(ctx, target);
    if (!chest) return { status: "failed", reason: `no chest at ${target ?? "base"}` };
    ctx.log(`deposit_items: heading for ${chest.name} at ${chest.position}`);
    const walk = await ctx.locomotion.goTo(chest.position, { see: true }, signal);
    if (walk.status !== "done") return walk;

    const block = bot.blockAt(chest.position);
    if (!block || block.name !== chest.name) return { status: "failed", reason: `no chest at ${chest.position}` };
    const window = await doOpen(bot, block);
    try {
      if (!("deposit" in window)) return { status: "failed", reason: "container cannot be stored in" };
      for (const item of toDeposit(ctx)) {
        if (signal.aborted) return { status: "interrupted" };
        try {
          await doMoveItem(window, item.type, item.count, "in");
        } catch (error) {
          return { status: "failed", reason: `could not store ${item.name}: ${error instanceof Error ? error.message : error}` };
        }
      }
      ctx.chests.remember(posId(chest.position), countByName(window.containerItems()), Date.now());
    } finally {
      await doClose(bot);
    }
    ctx.log("deposit_items: chest closed");
    return withJourney({ status: "done" }, walk);
  },
};

/** What to store, by item type: everything beyond what the goal wants carried. Nothing if it wants nothing. */
function toDeposit(ctx: MinecraftCtx): Deposit[] {
  const wants = ctx.wants();
  if (wants.length === 0) return [];
  return excessOver(ctx.bot.inventory.items(), Object.fromEntries(wants.map((w) => [w.item, w.count])));
}

/** Stacks beyond what to keep of each item name, by item type. */
export function excessOver(items: Deposit[], keep: Record<string, number>): Deposit[] {
  const left = { ...keep };
  const byType = new Map<number, Deposit>();
  for (const item of items) {
    const kept = Math.min(item.count, left[item.name] ?? 0);
    left[item.name] = (left[item.name] ?? 0) - kept;
    const count = item.count - kept;
    if (count === 0) continue;
    const entry = byType.get(item.type) ?? { type: item.type, name: item.name, count: 0 };
    entry.count += count;
    byType.set(item.type, entry);
  }
  return [...byType.values()];
}
