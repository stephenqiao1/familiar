// "That went wrong", at once: how far a movement came out from what was predicted, counted in
// spreads (the model's own usual error), and turned into a level from 0 to 1.

/** Shared while a movement has just come out far from its prediction, 0 to 1. Fades within a second. */
export const MISMATCH_SIGNAL = "mismatch";
/** A mismatch at or above this is a large one. */
export const LARGE_MISMATCH = 0.5;
/** The signal is gone this long after the movement. */
export const MISMATCH_FADE_MS = 1000;
/** One spread off is nothing; this many more is a full mismatch (so three spreads is a large one). */
const NOTHING = 1;
const FULL_AFTER = 4;

/** The width one spread is taken as: never under a tenth of the value, so a model that has always been exactly right is not thrown by a hair. */
export const widthOf = (value: number, spread: number) => Math.max(spread, 0.1 * Math.abs(value), 0.02);
/** How many spreads an error is. */
export const spreadsOff = (error: number, value: number, spread: number) => Math.abs(error) / widthOf(value, spread);
/** The mismatch level for a result this many spreads off. */
export const mismatchOf = (spreads: number) => Math.min(1, Math.max(0, (spreads - NOTHING) / FULL_AFTER));
/** What is left of a mismatch this long after it. */
export const faded = (size: number, ms: number) => size * Math.min(1, Math.max(0, 1 - ms / MISMATCH_FADE_MS));

/**
 * The mismatch for a change that was expected and did not follow. One miss is weak evidence (a
 * model stands on ten runs at most, and a drop can simply be seen late), so it is never a large
 * one: under `LARGE_MISMATCH`, and smaller the fewer runs the expectation stands on.
 */
export const missedChange = (model: { runs: number; changes: Record<string, number> }, change: string) => (LARGE_MISMATCH * (model.changes[change] ?? 0)) / (model.runs + 1);
