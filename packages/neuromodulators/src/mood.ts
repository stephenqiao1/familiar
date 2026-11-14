/** How fast past surprises fade: after this long one counts for about a third (1/e). */
const FADE_MS = 300_000;

/**
 * Mood (-1 to 1): a running average of recent surprises (outcomes better or worse than expected)
 * over about 5 minutes. Separate from patience on purpose: low patience does not mean sad.
 * For now it is only logged.
 *
 * TODO(mood): share it as a workspace signal once another brain part needs to read it. Signals
 * only hold 0 to 1 today, so first let setSignal take a range (e.g. { min: -1, max: 1 }) that is
 * stored with the value; keep 0 to 1 as the default so existing signals don't change.
 */
export interface Mood {
  /** Adds a surprise felt at time `at` (ms). */
  feel(surprise: number, at: number): void;
  level(at: number): number;
}

export function createMood(): Mood {
  let sum = 0;
  let weight = 0;
  let last = 0;
  const fade = (at: number) => {
    const kept = Math.exp(-Math.max(0, at - last) / FADE_MS);
    sum *= kept;
    weight *= kept;
    last = at;
  };
  return {
    feel(surprise, at) {
      fade(at);
      sum += surprise;
      weight += 1;
    },
    level(at) {
      fade(at);
      // Dividing by at least 1 lets a lone old surprise fade toward 0.
      return Math.min(1, Math.max(-1, sum / Math.max(1, weight)));
    },
  };
}
