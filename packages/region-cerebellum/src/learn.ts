import type { Estimate, Model } from "./model.js";
import type { CerebellumSettings } from "./settings.js";

// Learning by error. A reward only says good or bad; an error says how far off and which way,
// so each run corrects the prediction by the right amount. Pure: the same runs in the same
// order give the same models.

type Rates = Pick<CerebellumSettings, "settledRate" | "forgetAfterMs" | "forgetHalfLifeMs">;
type Forgetting = Pick<CerebellumSettings, "forgetAfterMs" | "forgetHalfLifeMs">;

/** How much of a count is left after going unused since `at`: all of it for a while, then halving every half-life. */
export const kept = (at: number, now: number, f: Forgetting) => 0.5 ** (Math.max(0, now - at - f.forgetAfterMs) / f.forgetHalfLifeMs);

/** How many runs an estimate still stands on: its count, less what going unused has cost it. */
export function sureOf(e: Pick<Estimate, "seen" | "at">, now: number, f: Forgetting): number {
  return e.seen * kept(e.at, now, f);
}

/** A value kept inside its stated bounds, so one strange run cannot teach a strange number. */
export function bounded(value: number, bounds?: readonly [number, number]): number {
  return bounds ? Math.min(bounds[1], Math.max(bounds[0], value)) : value;
}

/** What one result did to an estimate. `error` is signed: actual − predicted. */
export interface Lesson {
  estimate: Estimate;
  /** What was predicted before this run (null: the first run). */
  predicted: number | null;
  error: number;
  rate: number;
}

/**
 * One run's result for one measure. The prediction moves by rate × error (the sign carries
 * through) and the spread moves toward the size of the error the same way. The rate is 1 over
 * the count while the model is new and settles at `settledRate`; a model that went unused has
 * lost some of its count, so it moves quickly again.
 */
export function learnMeasure(before: Estimate | undefined, actual: number, now: number, rates: Rates, bounds?: readonly [number, number]): Lesson {
  const result = bounded(actual, bounds);
  if (!before) return { estimate: { value: result, spread: 0, seen: 1, at: now }, predicted: null, error: 0, rate: 1 };
  const seen = sureOf(before, now, rates) + 1;
  const rate = Math.min(1, Math.max(rates.settledRate, 1 / seen));
  const error = result - before.value;
  // The first error is the only word on the spread so far: take it whole.
  const spread = before.seen <= 1 ? Math.abs(error) : before.spread + rate * (Math.abs(error) - before.spread);
  return { estimate: { value: bounded(before.value + rate * error, bounds), spread, seen, at: now }, predicted: before.value, error, rate };
}

/** One run's changes: each change that followed is counted, over the runs so far. An unused model's counts shrink together, so the shares hold. */
export function learnChanges(before: Pick<Model, "runs" | "changes" | "at"> | undefined, followed: readonly string[], now: number, rates: Rates): Pick<Model, "runs" | "changes"> {
  const keep = before ? kept(before.at, now, rates) : 1;
  // Settled, a count is worth 1 over the rate: older runs fade, so a change that stops following stops being expected.
  const most = 1 / rates.settledRate;
  const fade = before && before.runs * keep + 1 > most ? (most - 1) / (before.runs * keep) : 1;
  const changes: Record<string, number> = {};
  for (const [change, count] of Object.entries(before?.changes ?? {})) changes[change] = count * keep * fade;
  for (const change of new Set(followed)) changes[change] = (changes[change] ?? 0) + 1;
  return { runs: (before?.runs ?? 0) * keep * fade + 1, changes };
}

/** How often a change has followed, 0 to 1. */
export const shareOf = (model: Pick<Model, "runs" | "changes">, change: string) => (model.runs > 0 ? Math.min(1, (model.changes[change] ?? 0) / model.runs) : 0);
