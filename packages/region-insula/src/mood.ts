// Mood (-1 to 1): how things have been going over the last minutes. Half of it is comfort (how
// good the body's state has been), half the recent surprises (outcomes better or worse than
// expected). It is separate from patience on purpose: low patience does not mean low mood.

/** How fast the past fades: after this long it counts for about a third (1/e). */
export const MOOD_FADE_MS = 300_000;

export interface Mood {
  /** One tick: the comfort now (0 to 1), and a surprise if one was just felt (-1 to 1). Returns the mood. */
  feel(comfort: number, surprise: number | null, at: number): number;
  level(): number;
}

export function createMood(): Mood {
  /** Comfort averaged over time, recentred to -1..1 (even at 0.5 comfort). */
  let ease = 0;
  /** A running average of surprises. */
  let sum = 0;
  let weight = 0;
  let last: number | null = null;
  const level = () => Math.min(1, Math.max(-1, 0.5 * ease + 0.5 * (sum / Math.max(1, weight))));
  return {
    feel(comfort, surprise, at) {
      const kept = last === null ? 1 : Math.exp(-Math.max(0, at - last) / MOOD_FADE_MS);
      // The first reading counts for little: mood starts even and moves slowly from there.
      ease = ease * kept + (2 * comfort - 1) * (last === null ? 0 : 1 - kept);
      sum *= kept;
      weight *= kept;
      if (surprise !== null && surprise !== 0) {
        sum += surprise;
        weight += 1;
      }
      last = at;
      return level();
    },
    level,
  };
}
