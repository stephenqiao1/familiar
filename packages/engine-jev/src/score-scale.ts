import type { Score } from "@familiar/contracts";

/** Jev rejects a rubric with more than 10 levels (HTTP 422; not in the SDK docs). */
export const MAX_SCORE_LEVELS = 10;

/**
 * Jev scores against an ordered rubric (levels 0..n-1) and returns the expected level, which may
 * be fractional. Our Score is a numeric min..max range, so it becomes evenly spaced levels
 * (one per whole number when that fits, otherwise 10) labelled with their values.
 */
export function scoreLevels(q: Score): string[] {
  const n = levelCount(q);
  return Array.from({ length: n }, (_, i) => label(q.min + (i * (q.max - q.min)) / (n - 1)));
}

/** Maps Jev's expected level back onto min..max. */
export function levelToScore(q: Score, level: number): number {
  return q.min + (level * (q.max - q.min)) / (levelCount(q) - 1);
}

function levelCount(q: Score): number {
  const span = q.max - q.min;
  return Number.isInteger(q.min) && Number.isInteger(q.max) && span + 1 <= MAX_SCORE_LEVELS ? span + 1 : MAX_SCORE_LEVELS;
}

function label(value: number): string {
  return String(Math.round(value * 100) / 100);
}
