import type { Bot } from "mineflayer";
import { sleepFor } from "../abort.js";
import { stepOf } from "../facing.js";
import { holdKey, releaseKeys } from "../primitives/keys.js";
import { isSafeToStand } from "../safety.js";
import type { Direction } from "../target.js";
import type { Recovery } from "./feel.js";

const JUMP_MS = 350;
const STEP_MS = 400;

/** Whether one step in a direction ends somewhere safe to stand (level, one up or one down). */
function safeStep(bot: Bot, dir: Direction): boolean {
  const to = bot.entity.position.floored().plus(stepOf(bot.entity.yaw, dir));
  return [0, -1, 1].some((dy) => isSafeToStand(bot, to.offset(0, dy, 0)));
}

/** Holds one key for a moment, then lets go. */
async function press(bot: Bot, key: "jump" | "back" | "left" | "right", ms: number, signal: AbortSignal): Promise<void> {
  holdKey(bot, key, true);
  try {
    await sleepFor(ms, signal);
  } finally {
    holdKey(bot, key, false);
  }
}

/**
 * One local correction for a stumble, tried before the layer above hears of it:
 *   jump: hop, in case a lip or a slab is in the way (the walking rhythm keeps pushing forward);
 *   sidestep: stop, step back and to one side, each only onto somewhere safe to stand;
 *   replan: nothing bodily; the caller drops the route and plans again from here.
 */
export async function recover(kind: Recovery, bot: Bot, pause: () => void, signal: AbortSignal): Promise<void> {
  if (kind === "jump") return press(bot, "jump", JUMP_MS, signal);
  if (kind !== "sidestep") return;
  pause();
  releaseKeys(bot);
  if (safeStep(bot, "back")) await press(bot, "back", STEP_MS, signal);
  const side = (["left", "right"] as const).find((dir) => safeStep(bot, dir));
  if (side) await press(bot, side, STEP_MS, signal);
}
