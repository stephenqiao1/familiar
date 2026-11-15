import type { Bot } from "mineflayer";
import { resolve } from "./aim.js";
import { openContainerOf, type OpenContainer } from "./windows.js";
import { primitive } from "./primitive.js";

/** Into the open container, or out of it. */
export type Way = "in" | "out";

/** Moves `count` of an item type into or out of an open container. Throws if it cannot (no room, none there). */
export async function doMoveItem(container: OpenContainer, itemType: number, count: number, way: Way): Promise<void> {
  if (way === "in") await container.deposit(itemType, null, count);
  else await container.withdraw(itemType, null, count);
}

/** What to move: the item's type, how many, and which way. Null if the target names nothing movable. */
function planOf(bot: Bot, target: string | undefined): { type: number; count: number; way: Way } | null {
  const container = openContainerOf(bot);
  const resolved = resolve(bot, target ?? "held");
  if (!container || resolved?.kind !== "item") return null;
  const carried = bot.inventory.items().filter((i) => i.name === resolved.name);
  const stored = container.containerItems().filter((i) => i.name === resolved.name);
  const parsed = target?.endsWith(":in") ? "in" : target?.endsWith(":out") ? "out" : null;
  // With no way given: put it in if the bot carries it, otherwise take it out.
  const way: Way = parsed ?? (carried.length ? "in" : "out");
  const stacks = way === "in" ? carried : stored;
  const count = stacks.reduce((sum, i) => sum + i.count, 0);
  return count > 0 ? { type: stacks[0]!.type, count, way } : null;
}

/** With a container open, puts all of a named item in, or takes all of it out. */
export const moveItem = primitive({
  name: "move_item",
  description: "With a container open, move an item: item:<name>:in, item:<name>:out, or held (puts the held item in).",
  parts: ["hands"],
  // Something is gained (taken out) or lost (put in); which one depends on the way.
  expects: [],
  usesWindow: true,

  canRun(ctx, target) {
    return planOf(ctx.bot, target) !== null;
  },

  async run(ctx, target, signal) {
    const container = openContainerOf(ctx.bot);
    const plan = planOf(ctx.bot, target);
    if (!container) return { status: "failed", reason: "no container is open" };
    if (!plan) return { status: "failed", reason: `nothing to move for "${target ?? "held"}"` };
    if (signal.aborted) return { status: "interrupted" };
    await doMoveItem(container, plan.type, plan.count, plan.way);
    return { status: "done" };
  },
});
