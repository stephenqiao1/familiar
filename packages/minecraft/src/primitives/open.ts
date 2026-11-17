import type { Bot } from "mineflayer";
import type { Block } from "../mc-types.js";
import { AHEAD, blockOf, withinReach } from "./aim.js";
import { rememberOpen, type OpenContainer } from "./windows.js";
import { primitive } from "./primitive.js";

/** Blocks that open onto slots the bot can put things in and take things out of. */
const OPENABLE = new Set(["chest", "trapped_chest", "barrel", "ender_chest", "hopper", "dispenser", "dropper"]);

/** Whether a block is a container the bot can open. */
export function isOpenable(name: string): boolean {
  return OPENABLE.has(name) || name.endsWith("shulker_box");
}

/**
 * Opens a container block and returns it, left open. Close it with `doClose`.
 * Returns null if stopped first: a container that never opens (too far, blocked) would otherwise
 * hold the caller for Mineflayer's 20 seconds, and nothing else, not even a reflex, could act.
 */
export async function doOpen(bot: Bot, block: Block, signal?: AbortSignal): Promise<OpenContainer | null> {
  if (signal?.aborted) return null;
  const opening = bot.openContainer(block);
  let stop = () => {};
  const stopped = new Promise<null>((resolve) => {
    stop = () => resolve(null);
    signal?.addEventListener("abort", stop, { once: true });
  });
  try {
    const container = await Promise.race([opening, stopped]);
    if (container) rememberOpen(bot, container);
    // Stopped: if it opens late after all, shut it again; if it never does, that is not an error.
    else opening.then((late) => bot.closeWindow(late), () => {});
    return container;
  } finally {
    signal?.removeEventListener("abort", stop);
  }
}

/**
 * Opens a container within reach and leaves it open, so `move_item` can use it. The next
 * primitive that does not work with a container closes it, as does `close`.
 */
export const open = primitive({
  name: "open",
  description: "Open a container within reach (pos:x,y,z, dir:<direction> or ahead; default: ahead).",
  parts: ["hands", "head"],
  expects: ["opened"],
  usesWindow: true,
  defaultTarget: () => AHEAD,

  canRun(ctx, target) {
    return container(ctx.bot, target) !== null && ctx.bot.currentWindow === null;
  },

  async run(ctx, target, signal) {
    const block = container(ctx.bot, target);
    if (!block) return { status: "failed", reason: "no container within reach there" };
    return (await doOpen(ctx.bot, block, signal)) ? { status: "done" } : { status: "interrupted" };
  },
});

function container(bot: Bot, target: string | undefined): Block | null {
  const block = blockOf(bot, target ?? AHEAD);
  return block && isOpenable(block.name) && withinReach(bot, block.position.offset(0.5, 0.5, 0.5)) ? block : null;
}
