import type { Bot } from "mineflayer";
import type { Entity } from "../mc-types.js";
import { entityOf, PRIMITIVE_MS, REACH } from "./aim.js";
import { primitive } from "./primitive.js";

/** Steps onto a dropped item close by, which picks it up. It travels through the locomotion controller. */
export const pickUp = primitive({
  name: "pick_up",
  description: "Pick up a dropped item within 4 blocks (default: the nearest).",
  parts: ["legs", "head"],
  expects: ["gained"],
  settleMs: 300,

  canRun(ctx, target) {
    return droppedItem(ctx.bot, target) !== null;
  },

  async run(ctx, target, signal) {
    const { bot } = ctx;
    const item = droppedItem(bot, target);
    if (!item) return { status: "failed", reason: "no dropped item close by" };
    const result = await ctx.locomotion.goTo(item.position, { range: 0 }, AbortSignal.any([signal, AbortSignal.timeout(PRIMITIVE_MS)]));
    if (signal.aborted) return { status: "interrupted" };
    if (result.status === "failed") return { status: "failed", ...(result.reason ? { reason: result.reason } : {}) };
    return item.isValid ? { status: "failed", reason: "not picked up yet" } : { status: "done" };
  },
});

function droppedItem(bot: Bot, target: string | undefined): Entity | null {
  const close = (e: Entity) => e.name === "item" && e.position.distanceTo(bot.entity.position) <= REACH;
  const entity = target === undefined ? bot.nearestEntity(close) : entityOf(bot, target);
  return entity && close(entity) ? entity : null;
}
