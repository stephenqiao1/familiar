import type { Bot } from "mineflayer";
import type { goals } from "mineflayer-pathfinder";

/** With no usable route after this long, a journey that needs one fails. */
const NO_PATH_MS = 10_000;
/** A single round of route planning slower than this is logged: it holds up everything else. */
const SLOW_PLAN_MS = 100;
/** How long the pathfinder may think about one route, and how much of each game tick it may use. */
const THINK = { totalMs: 3000, perTickMs: 15 };

/** What the pathfinder reports when it has planned. */
interface PathUpdate {
  status: string;
  path: unknown[];
  time?: number;
}

/**
 * The walk pattern: the pathfinder, which produces the stepping rhythm by itself once given a
 * goal. This file and the controller's tick are the only code that touches `bot.pathfinder`.
 */
export interface Walk {
  /** Sets off toward a goal (replacing any other). `dynamic`: the goal follows something that moves. */
  start(goal: goals.Goal, dynamic: boolean): void;
  /** Drops the route and stands still. */
  stop(): void;
  /** The pathfinder says the goal is reached. */
  reached(): boolean;
  /** Why no route could be found, or null. */
  failure(now: number): string | null;
  /** The planned route's length in blocks, once one is known. */
  pathLength(): number | null;
  /** Supposed to be covering ground right now (not standing at the goal, digging or building). */
  expectedToMove(): boolean;
  /** The route is being walked plainly (not digging or building). */
  plain(): boolean;
}

export function createWalk(bot: Bot, log: (msg: string) => void, now: () => number): Walk {
  let reached = false;
  let failed: string | null = null;
  let length: number | null = null;
  let startedAt = 0;
  let gotPath = false;
  bot.pathfinder.thinkTimeout = THINK.totalMs;
  bot.pathfinder.tickTimeout = THINK.perTickMs;

  let thoughtFor = 0;
  bot.on("path_update", (update: PathUpdate) => {
    // The pathfinder reports the running total for a route; one round is the step since the last report.
    const total = update.time ?? 0;
    const round = total >= thoughtFor ? total - thoughtFor : total;
    thoughtFor = update.status === "partial" ? total : 0;
    if (round > SLOW_PLAN_MS) log(`locomotion: one round of planning took ${Math.round(round)} ms (${update.status})`);
    if (update.status === "noPath") failed = "No path to the goal!";
    else if (update.status === "timeout" && update.path.length === 0) failed = "Took too long to decide a path to the goal";
    else if (update.path.length > 0 || update.status === "success" || update.status === "partial") {
      gotPath = true;
      failed = null;
      length ??= update.path.length;
    }
  });
  bot.on("goal_reached", () => {
    reached = true;
  });

  return {
    start(goal, dynamic) {
      reached = false;
      failed = null;
      length = null;
      gotPath = false;
      startedAt = now();
      bot.pathfinder.setGoal(goal, dynamic);
    },
    stop() {
      bot.pathfinder.setGoal(null);
    },
    reached: () => reached,
    failure(at) {
      if (failed) return failed;
      return !gotPath && !reached && at - startedAt > NO_PATH_MS ? `no path found within ${NO_PATH_MS / 1000}s` : null;
    },
    pathLength: () => length,
    expectedToMove: () => bot.pathfinder.isMoving() && !bot.pathfinder.isMining() && !bot.pathfinder.isBuilding(),
    plain: () => bot.pathfinder.isMoving() && !bot.pathfinder.isMining() && !bot.pathfinder.isBuilding(),
  };
}
