// How much is enough. A need about having some of a thing has a base target; the moment moves
// it (a table of adjustments, written where the game is known), and running out raises it for a
// while. Pure: plain numbers in, plain numbers out.

/** What running out does to a target, and how it comes back. */
export const LEARNING = {
  /** Each time the bot runs out, enough becomes this much more. */
  raise: 1.25,
  /** Never more than this many times the base. */
  most: 3,
  /** A raised target drifts back to its base with this time constant: three game days (an hour). */
  driftSeconds: 3 * 20 * 60,
  /** The need a thing is kept for counts as pressing above this: running out then is a shortage. */
  pressingAbove: 0.5,
};

/** One reason enough is more (or less) right now: `times` says how many times the base (1: no change). */
export interface Adjustment<S, C = unknown> {
  need: string;
  why: string;
  times(state: S, clock: C | null): number;
}

/** The target right now: base × each adjustment that holds × what was learned; each by its strength (0: the base). */
export function targetNow(base: number, adjustments: readonly number[], learned: number, strengths: { targets: number; learnTargets: number }): number {
  const moment = adjustments.reduce((product, times) => product * (1 + strengths.targets * (times - 1)), 1);
  return base * moment * (strengths.learnTargets > 0 ? 1 + strengths.learnTargets * (learned - 1) : 1);
}

/** The learned multiplier after running out once more. */
export function afterShortage(multiplier: number): number {
  return Math.min(LEARNING.most, Math.max(1, multiplier) * LEARNING.raise);
}

/** The learned multiplier after `seconds` with no shortage: back toward 1. */
export function driftBack(multiplier: number, seconds: number): number {
  return 1 + (Math.max(1, multiplier) - 1) * Math.exp(-Math.max(0, seconds) / LEARNING.driftSeconds);
}

/** What the bot has learned about how much is enough: for each need, how many times its base, and when that was true. */
export interface TargetMemory {
  /** The multiplier for a need at time `now` (ms), drifted back since it was last set. */
  get(need: string, now: number): number;
  /** The bot ran out: enough is more from now on. Returns the new multiplier. */
  shortage(need: string, now: number): number;
  /** For saving. */
  entries(): Record<string, { times: number; at: number }>;
}

export function createTargetMemory(saved: Record<string, { times: number; at: number }> = {}): TargetMemory {
  const learned = new Map(Object.entries(saved));
  const get = (need: string, now: number) => {
    const entry = learned.get(need);
    return entry ? driftBack(entry.times, (now - entry.at) / 1000) : 1;
  };
  return {
    get,
    shortage(need, now) {
      const times = afterShortage(get(need, now));
      learned.set(need, { times, at: now });
      return times;
    },
    entries: () => Object.fromEntries(learned),
  };
}
