import type { Field } from "./field.js";

// Sky and ground: what a thing's place and movement on the map lean the body toward, before
// anything knows what the thing is. Decided from physical facts only, never from its kind.
// The lean is advice: the defence circuit and instinct decide what to do with it.
// Change what counts as a dive, a fly-over or a small thing on the ground in the table.

export type Lean = "avoid" | "freeze" | "approach";

/** What is known about the thing, in plain numbers. */
export interface LeanFacts {
  field: Field;
  /** How strongly it looms, 0 to 1. */
  looming: number;
  /** How fast it moves across the view, in blocks a second. */
  across: number;
  /** How fast it is coming nearer, in blocks a second (negative: going away). */
  closing: number;
  /** How tall it is, in blocks. Unknown: leave out. */
  height?: number;
  /** Blocks away. Unknown: leave out. */
  dist?: number;
  /** A need for safety presses right now. */
  safetyPresses: boolean;
}

export const LEAN = {
  /** Looming at least this strongly overhead is a dive. */
  dive: { looming: 0.5 },
  /** Crossing the sky at least this fast, and coming nearer no faster than this, is a fly-over. */
  flyOver: { across: 1, closing: 0.5 },
  /** No taller than this, moving but no faster than this, within this many blocks and not coming at the body: worth a closer look. */
  small: { height: 1, moving: 0.2, speed: 2, within: 6, closing: 0.5 },
};

/** The table: the first row that fits gives the lean. */
const ROWS: { lean: Lean; when(f: LeanFacts): boolean }[] = [
  { lean: "avoid", when: (f) => f.field === "upper" && f.looming >= LEAN.dive.looming },
  { lean: "freeze", when: (f) => f.field === "upper" && f.across >= LEAN.flyOver.across && f.closing <= LEAN.flyOver.closing },
  {
    lean: "approach",
    when: (f) => f.field !== "upper" && !f.safetyPresses && f.looming <= 0 && (f.height ?? Infinity) <= LEAN.small.height && f.across >= LEAN.small.moving && f.across <= LEAN.small.speed && f.closing <= LEAN.small.closing && (f.dist ?? Infinity) <= LEAN.small.within,
  },
];

/** What the thing leans the body toward, or null for nothing (the bot then behaves as it always did). */
export function leanOf(facts: LeanFacts): Lean | null {
  return ROWS.find((row) => row.when(facts))?.lean ?? null;
}
