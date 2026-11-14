/** How fast past payouts fade: after this long one counts for about a third (1/e). */
const FADE_MS = 300_000;

/** A reward this big counts as one full repeat; a smaller one counts in proportion. */
const FULL_REWARD = 0.5;

/**
 * Guardrail against reward loops: repeated rewards from the same source shrink. Each positive
 * reward is scaled by ½^(how much that source paid recently), and the count fades over a few
 * minutes, so a source pays in full again after a quiet spell. Negative rewards never shrink.
 * Small rewards count for little, so a trickle (health coming back a sliver at a time) does not
 * wear down the reward for a real one later.
 */
export interface Habituation {
  /** The reward from `source` at time `at` (ms) after shrinking, and the recent repeat count used. */
  dampen(source: string, amount: number, at: number): { amount: number; repeats: number };
}

export function createHabituation(): Habituation {
  const recent = new Map<string, { count: number; at: number }>();
  return {
    dampen(source, amount, at) {
      if (amount <= 0) return { amount, repeats: 0 };
      const last = recent.get(source);
      const repeats = last ? last.count * Math.exp(-Math.max(0, at - last.at) / FADE_MS) : 0;
      recent.set(source, { count: repeats + Math.min(1, amount / FULL_REWARD), at });
      return { amount: amount * 0.5 ** repeats, repeats };
    },
  };
}
