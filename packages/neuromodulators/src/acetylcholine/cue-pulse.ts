import type { Thing } from "../dopamine/cues.js";

/** A cue must be seen on this many observations in a row before it fires (a guard against false alarms). */
const CONFIRMATIONS = 2;

/**
 * Effect e, the cue pulse: marks the moment something the bot was looking for comes into view,
 * the switch from scanning to acting. A thing fires once, when it has been seen on two
 * observations in a row, and not again until it has left view.
 */
export interface CuePulse {
  /** Feed the watched-for things in view right now; returns the one whose cue fires now, if any. */
  observe(inView: Thing[]): Thing | null;
}

export function createCuePulse(): CuePulse {
  /** Thing id → how many observations in a row it has been in view. */
  let streak = new Map<string, number>();
  return {
    observe(inView) {
      const next = new Map(inView.map((t) => [t.id, (streak.get(t.id) ?? 0) + 1]));
      streak = next;
      return inView.find((t) => next.get(t.id) === CONFIRMATIONS) ?? null;
    },
  };
}
