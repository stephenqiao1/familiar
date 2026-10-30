import type { Skill } from "@familiar/contracts";
import type { Bot } from "mineflayer";
import pathfinder from "mineflayer-pathfinder";
import { nearestHostile } from "../mobs.js";
import type { MinecraftCtx } from "../skill-context.js";
import { walkTo } from "../walk-to.js";

const { GoalNear } = pathfinder.goals;
const HOSTILE_RANGE = 8;

/** Walks to the base bed and sleeps until morning. */
export const sleep: Skill<MinecraftCtx> = {
  name: "sleep",
  description: "Go to the base bed and sleep through the night.",

  canRun(ctx) {
    const { bot } = ctx;
    return !bot.time.isDay && !bot.isSleeping && nearestHostile(bot, HOSTILE_RANGE) === null;
  },

  async run(ctx, _target, signal) {
    const { bot, base } = ctx;
    ctx.log(`sleep: heading for bed at ${base.bed}`);
    const walk = await walkTo(bot, new GoalNear(base.bed.x, base.bed.y, base.bed.z, 2), signal);
    if (walk.status !== "done") return walk;

    const bed = bot.blockAt(base.bed);
    if (!bed || !bot.isABed(bed)) return { status: "failed", reason: `no bed at ${base.bed}` };

    try {
      await bot.sleep(bed);
    } catch (error) {
      return { status: "failed", reason: error instanceof Error ? error.message : String(error) };
    }
    return untilWake(bot, signal);
  },
};

/** Resolves "done" when the bot wakes; on abort, gets out of bed and resolves "interrupted". */
function untilWake(bot: Bot, signal: AbortSignal): Promise<{ status: "done" | "interrupted" }> {
  return new Promise((resolve) => {
    const onWake = () => {
      signal.removeEventListener("abort", onAbort);
      resolve({ status: "done" });
    };
    const onAbort = () => {
      bot.off("wake", onWake);
      void bot.wake().catch(() => {});
      resolve({ status: "interrupted" });
    };
    bot.once("wake", onWake);
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
