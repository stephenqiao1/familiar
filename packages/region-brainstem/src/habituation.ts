// Getting used to things: a thing that wins a look (or startles) and then does nothing counts
// for less next time, and comes back over about a minute. Used by the colliculus and by startle.

export interface Habituation {
  /** How much of its salience a thing keeps, 0 to 1: the lowest of its keys (the thing itself, its kind at that place). */
  factor(keys: string[], now: number): number;
  /** The thing won a look and nothing followed: damp it a step. */
  damp(keys: string[], now: number): void;
  /** It did something new: back to full at once. */
  restore(keys: string[]): void;
  /** What is damped right now, for the log. */
  damped(now: number): Record<string, number>;
}

/** Each harmless win leaves this much. */
const STEP = 0.8;
const RECOVER_MS = 60_000;
const NEVER_BELOW = 0.1;

/** `step`: how much is left after each harmless time. Default: 0.8. */
export function createHabituation(step = STEP): Habituation {
  const marks = new Map<string, { factor: number; at: number }>();
  /** Recovers steadily: whatever was lost comes back over about a minute. */
  const now_ = (key: string, now: number) => {
    const mark = marks.get(key);
    if (!mark) return 1;
    const factor = Math.min(1, mark.factor + (1 - mark.factor) * ((now - mark.at) / RECOVER_MS));
    if (factor >= 1) marks.delete(key);
    return factor;
  };
  return {
    factor: (keys, now) => Math.min(1, ...keys.map((key) => now_(key, now))),
    damp(keys, now) {
      for (const key of keys) marks.set(key, { factor: Math.max(NEVER_BELOW, now_(key, now) * step), at: now });
    },
    restore(keys) {
      for (const key of keys) marks.delete(key);
    },
    damped(now) {
      return Object.fromEntries([...marks.keys()].map((key) => [key, Math.round(now_(key, now) * 100) / 100] as const).filter(([, f]) => f < 1));
    },
  };
}
