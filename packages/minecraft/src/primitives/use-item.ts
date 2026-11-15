import type { Bot } from "mineflayer";
import { sleepFor } from "../abort.js";
import { primitive } from "./primitive.js";

/** An item is held in use for at most this long. */
export const USE_LIMIT_MS = 3000;
const POLL_MS = 50;

/**
 * Uses the item in hand and holds it until the use finishes (the item is eaten or drunk, or
 * otherwise used up or changed) or the time limit, then lets go. It always lets go, even when
 * stopped, so an item is never left in use. Returns whether the use finished.
 */
export async function doUseItem(bot: Bot, signal: AbortSignal, limitMs = USE_LIMIT_MS): Promise<boolean> {
  const mark = () => `${bot.heldItem?.name ?? ""}×${bot.heldItem?.count ?? 0}/${bot.food}`;
  const before = mark();
  const started = Date.now();
  bot.activateItem();
  try {
    while (Date.now() - started < limitMs) {
      if (mark() !== before) return true;
      await sleepFor(POLL_MS, signal);
    }
    return false;
  } finally {
    bot.deactivateItem();
  }
}

/** Uses the item in hand (eats, drinks, draws and looses a bow) and lets go when it is done. */
export const useItem = primitive({
  name: "use_item",
  description: "Use the item in hand until it is used up or 3 seconds pass (eat, drink, draw a bow), then let go.",
  parts: ["hands"],
  expects: [],

  canRun(ctx) {
    return ctx.bot.heldItem !== null;
  },

  async run(ctx, _target, signal) {
    if (ctx.bot.heldItem === null) return { status: "failed", reason: "nothing in hand" };
    const finished = await doUseItem(ctx.bot, signal);
    return finished ? { status: "done" } : { status: "done", reason: "held for 3 seconds, then let go" };
  },
});
