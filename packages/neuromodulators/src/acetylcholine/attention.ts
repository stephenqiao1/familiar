/** How the encoder's budget is spent. */
export interface AttentionBudget {
  /** How many of each kind of nearby thing to keep. */
  nearby: number;
  /** How many remembered items (memories) to pass on. */
  remembered: number;
}

/** The budget with the effect off, and at resting focus. */
export const NEUTRAL_BUDGET: AttentionBudget = { nearby: 10, remembered: 5 };
/** Guardrail: when the nearby limit is hit on more than this share of ticks over a minute, detail is cut for the next minute. */
const SWAMPED_SHARE = 0.5;
const WINDOW_MS = 60_000;

/**
 * Effect b, the attention budget: high focus takes in more nearby detail and fewer remembered
 * items; low focus the reverse. At focus 0.5 it is the neutral budget.
 */
export interface Attention {
  /** The budget for this tick. */
  budget(focus: number, now: number): AttentionBudget;
  /** Report whether the nearby limit was hit this tick; returns a note when detail gets cut. */
  report(hitLimit: boolean, now: number): string | null;
}

export function createAttention(): Attention {
  let ticks: { at: number; hit: boolean }[] = [];
  let cutUntil = -Infinity;
  let windowFrom: number | null = null;
  return {
    budget(focus, now) {
      const nearby = Math.round(5 + 10 * focus);
      return { nearby: now < cutUntil ? Math.ceil(nearby / 2) : nearby, remembered: Math.round(8 - 6 * focus) };
    },
    report(hitLimit, now) {
      windowFrom ??= now;
      ticks = [...ticks.filter((t) => now - t.at <= WINDOW_MS), { at: now, hit: hitLimit }];
      const swamped = now - windowFrom >= WINDOW_MS && ticks.filter((t) => t.hit).length / ticks.length > SWAMPED_SHARE;
      if (!swamped || now < cutUntil) return null;
      cutUntil = now + WINDOW_MS;
      windowFrom = now + WINDOW_MS;
      ticks = [];
      return "swamped: the state hit its size limit on over half of the last minute's ticks, so detail is cut for a minute";
    },
  };
}
