import type { Bot } from "mineflayer";
import type { goals } from "mineflayer-pathfinder";

/**
 * Walks to `goal`. If the signal fires, stops at once (cancels the path, releases the movement
 * keys, stops any digging) and rejects with `signal.reason` without waiting for the pathfinder.
 */
export function abortableGoto(bot: Bot, goal: goals.Goal, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => {
      bot.pathfinder.setGoal(null);
      bot.clearControlStates();
      bot.stopDigging();
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    bot.pathfinder.goto(goal).then(
      () => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) reject(signal.reason);
        else resolve();
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(signal.aborted ? signal.reason : error);
      },
    );
  });
}

/** Waits `ms`; rejects with `signal.reason` if the signal fires first. */
export function sleepFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
