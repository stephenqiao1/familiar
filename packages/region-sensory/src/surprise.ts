// What the sensory area reports: one difference between its guess and what is in view.

/** `unexpected`, 0 to 1: the strongest difference between what the sensory area guessed and what is in view. */
export const UNEXPECTED_SIGNAL = "unexpected";
/** A surprise at least this strong is a strong one: the hippocampus keeps it and the planner is woken. */
export const STRONG_SURPRISE = 0.7;

/** How strong each kind of difference is at its fullest. A broken expectation counts fully. */
export const SIZE = { new: 0.6, missing: 0.8, changed: 0.5, expectation: 1 };
/** What was in view within this long is "here a moment ago": it is expected now. */
export const MOMENT_MS = 5000;
/** A difference stays reported for this long, so every reader hears it. */
export const HOLD_MS = 3000;
/** A place is not judged until the bot has looked about it this many times. */
export const MIN_LOOKS = 3;
/** A kind in view on at least this share of the looks is usually here. */
export const USUAL_SHARE = 0.6;
/** Nothing is called missing until the bot has been in the cell this long (the first states of a place are thin). */
export const SETTLE_MS = 2000;

export interface Surprise {
  /** A kind never seen here, a usual thing missing, a change never seen before, or an expectation from above that broke. */
  what: "new" | "missing" | "changed" | "expectation";
  /** The kind of thing it is about (for an expectation: the expectation's own words). */
  kind: string;
  /** The things it is about, if they are in view. */
  ids: string[];
  /** 0 to 1. */
  size: number;
  /** In plain words. */
  why: string;
  /** When it was first noticed (ms). */
  at: number;
}

/** How far a number of looks can be trusted, 0 to 1: half way at four looks. */
export const known = (looks: number) => 1 - 0.5 ** (looks / 4);
