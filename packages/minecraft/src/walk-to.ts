import type { SkillResult } from "@familiar/contracts";
import type { Bot } from "mineflayer";
import type { goals } from "mineflayer-pathfinder";
import { abortableGoto } from "./abort.js";

const NO_PATH_MS = 10_000;

/**
 * Walks to `goal` and reports how it went. Fails if the pathfinder hasn't found any route
 * (full or partial) within 10 s; reports "interrupted" if `signal` fires.
 */
export async function walkTo(bot: Bot, goal: goals.Goal, signal: AbortSignal): Promise<SkillResult> {
  const noPath = new AbortController();
  const timer = setTimeout(() => noPath.abort(new Error("no path")), NO_PATH_MS);
  const onPath = (path: { status: string; path: unknown[] }) => {
    if (path.status === "success" || path.status === "partial" || path.path.length > 0) clearTimeout(timer);
  };
  bot.on("path_update", onPath);

  try {
    await abortableGoto(bot, goal, AbortSignal.any([signal, noPath.signal]));
    return { status: "done" };
  } catch (error) {
    if (signal.aborted) return { status: "interrupted" };
    if (noPath.signal.aborted) return { status: "failed", reason: `no path found within ${NO_PATH_MS / 1000}s` };
    return { status: "failed", reason: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
    bot.off("path_update", onPath);
  }
}
