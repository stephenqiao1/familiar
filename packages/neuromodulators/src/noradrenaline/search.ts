import type { Workspace } from "@familiar/contracts";
import { NOVELTY_SIGNAL, REWARD_SIGNAL, SURPRISE_SIGNAL } from "../dopamine/tonic.js";

export const SEARCH_MIN = 0.05;
export const SEARCH_MAX = 0.95;
/** How far one input at full strength moves the level search heads for. */
const INPUT_WEIGHT = 0.35;
/** A one-off bump when something new appears. */
const NOVELTY_BUMP = 0.05;

/**
 * One thing that moves search: above 0 pushes it up ("this isn't working"), below 0 pulls it down
 * ("this is working"), from -1 to 1. Inputs may keep their own running state.
 */
export interface SearchInput {
  name: string;
  read(ws: Workspace, now: number): number;
}

/**
 * Search (0.05 to 0.95), the slow noradrenaline dial: it heads for the resting level plus its
 * inputs, with the given time constant, so with nothing pushing it it drifts back to rest.
 */
export interface Search {
  /** Feeds the inputs' sum at time `at` (ms), and any one-off bump; returns the new level. */
  update(pressure: number, bump: number, at: number): number;
  level(): number;
}

export function createSearch(settings: { searchResting: number; searchTimeConstantSeconds: number }): Search {
  let level = settings.searchResting;
  let last: number | null = null;
  const clamp = (n: number) => Math.min(SEARCH_MAX, Math.max(SEARCH_MIN, n));
  return {
    update(pressure, bump, at) {
      const dt = last === null ? 0 : Math.max(0, at - last) / 1000;
      last = at;
      const target = Math.min(1, Math.max(0, settings.searchResting + INPUT_WEIGHT * pressure));
      level = clamp(level + (target - level) * Math.min(1, dt / settings.searchTimeConstantSeconds) + bump);
      return level;
    },
    level: () => level,
  };
}

/** A signal's value if it was set since the last look, else null. */
function freshReader(name: string): (ws: Workspace) => number | null {
  let seenAt = -1;
  return (ws) => {
    const signal = ws.signals[name];
    if (!signal || signal.at === seenAt) return null;
    seenAt = signal.at;
    return signal.value;
  };
}

// The inputs. Add or remove one: write it here and edit createSearchInputs.

/** Recent reward within this share of its usual rate counts as holding up. */
const HOLDING_UP = 0.2;
/** What steady success contributes: a pull down. */
const STEADY_SUCCESS = -0.5;
const FAST_MS = 60_000;
const SLOW_MS = 300_000;

/** Recent reward against its own longer average: up while it is falling, down while it holds or grows. */
export function rewardTrend(): SearchInput {
  const reward = freshReader(REWARD_SIGNAL);
  let fast = 0;
  let slow = 0;
  let last: number | null = null;
  return {
    name: "reward_trend",
    read(ws, now) {
      const dt = last === null ? 0 : Math.max(0, now - last);
      last = now;
      const got = reward(ws) ?? 0;
      fast = fast * Math.exp(-dt / FAST_MS) + got;
      slow = slow * Math.exp(-dt / SLOW_MS) + got;
      // Per-minute rates. With no reward lately there is nothing to compare.
      const [recent, usual] = [fast, slow / (SLOW_MS / FAST_MS)];
      if (usual < 0.01) return 0;
      const falling = (usual - recent) / usual;
      return falling < HOLDING_UP ? STEADY_SUCCESS : Math.min(1, falling);
    },
  };
}

const MEDIUM_SURPRISE = 0.3;
/** At or above this a surprise is big: alarm's business, not search's. */
export const BIG_SURPRISE = 0.6;
const FAILED_PREDICTIONS = 3;

/** Predictions keep failing: several medium surprises in a row, none big enough to trip alarm. */
export function failedPredictions(): SearchInput {
  const surprise = freshReader(SURPRISE_SIGNAL);
  let inARow = 0;
  return {
    name: "failed_predictions",
    read(ws) {
      const size = surprise(ws);
      // 0 means no skill ended this tick; only a real outcome extends or breaks the run.
      if (size !== null && size > 0) inARow = size >= MEDIUM_SURPRISE && size < BIG_SURPRISE ? inARow + 1 : 0;
      return inARow >= FAILED_PREDICTIONS ? 1 : 0;
    },
  };
}

const STALL_STARTS_MS = 120_000;
const STALL_FULL_MS = 240_000;
const JUST_FINISHED_MS = 30_000;

/** The goal's steps: up when none has been finished for a while, down right after one is. */
export function goalProgress(): SearchInput {
  let since: number | null = null;
  let lastDoneAt: number | null = null;
  return {
    name: "goal_progress",
    read(ws, now) {
      const goal = ws.goal;
      if (!goal) {
        since = null;
        return 0;
      }
      if (goal.stepDoneAt !== lastDoneAt) {
        lastDoneAt = goal.stepDoneAt;
        since = now;
        return -1;
      }
      since ??= now;
      const waited = now - since;
      if (goal.stepDoneAt !== null && waited < JUST_FINISHED_MS) return -1;
      return Math.max(0, Math.min(1, (waited - STALL_STARTS_MS) / (STALL_FULL_MS - STALL_STARTS_MS)));
    },
  };
}

/** A fresh set of every search input (each keeps its own running state). */
// HOOK(stuck): the brainstem shares a `stuck` signal (1 while the legs cannot get anywhere, fading
// over about 5 seconds). Being stuck is a sign the current approach is not working, so it belongs
// here as one more input that pushes search up. Not wired yet.

export function createSearchInputs(): SearchInput[] {
  return [rewardTrend(), failedPredictions(), goalProgress()];
}

/** The one-off bump for something new coming into view this tick. */
export function noveltyBump(): (ws: Workspace) => number {
  const novelty = freshReader(NOVELTY_SIGNAL);
  return (ws) => ((novelty(ws) ?? 0) > 0 ? NOVELTY_BUMP : 0);
}
