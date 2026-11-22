import type { Workspace } from "@familiar/contracts";
import { NOVELTY_SIGNAL } from "../dopamine/tonic.js";

export const SEARCH_MIN = 0.05;
export const SEARCH_MAX = 0.95;
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
 * Search (0.05 to 0.95), the slow noradrenaline dial. Its inputs add up to a pressure from -1 to
 * 1, and it heads, with the given time constant, for a level set by that: the resting level at
 * 0, all the way up at 1 and all the way down at -1. So with nothing pushing it it drifts back
 * to rest, and with a need going unanswered it can reach the levels its effects act at.
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
      const p = Math.min(1, Math.max(-1, pressure));
      const target = p >= 0 ? settings.searchResting + (1 - settings.searchResting) * p : settings.searchResting * (1 + p);
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

// The inputs. Add or remove one where the region is created.

/** What nothing pressing contributes: a pull down ("this is working"). */
const CONTENT = -0.5;

/**
 * A need is pressing and what the bot is doing is not easing it. `pressing` is how hard the
 * worst unanswered need presses (0 to 1), `progress` how fresh the running skill's last progress
 * is (1 = just now, 0 = none lately, or nothing running). Up by how hard the need presses while
 * the bot is getting nowhere; down while it is getting somewhere, or while nothing presses.
 */
export function gettingNowhere(pressing: (ws: Workspace) => number, progress: (ws: Workspace, now: number) => number): SearchInput {
  return {
    name: "getting_nowhere",
    read(ws, now) {
      const need = Math.min(1, Math.max(0, pressing(ws)));
      return need === 0 ? CONTENT : need * (1 - 2 * Math.min(1, Math.max(0, progress(ws, now))));
    },
  };
}

/** The one-off bump for something new coming into view this tick. */
export function noveltyBump(): (ws: Workspace) => number {
  const novelty = freshReader(NOVELTY_SIGNAL);
  return (ws) => ((novelty(ws) ?? 0) > 0 ? NOVELTY_BUMP : 0);
}
