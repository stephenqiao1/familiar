import type { BodyClock, State } from "@familiar/contracts";

/** What a need may read besides the state, when its level is worked out. */
export interface NeedContext {
  /** A body signal shared this tick (the medulla's `cold`, `tired`, `sick`), or undefined if nobody shares it. */
  signal(name: string): number | undefined;
  /** How much is enough right now, for a need that has a target (its base, moved by the moment and by what was learned). */
  target: number;
  /** The time of day, when the body has a clock. */
  clock: BodyClock | null;
}

/** Which of the settings' weights a need takes: a threat to life, the body right now, or being provided for. */
export type Weighs = "danger" | "body" | "provision";

/**
 * One of the body's needs: a fact about the body (low energy), read from the state. Which needs
 * exist is inborn: this list is the built-in knowledge of a bot that otherwise learns. What
 * relieves a need, and so what is worth wanting, is learned (dopamine does that half).
 */
export interface Need {
  name: string;
  /** What it is about ("hunger", "safety", "having_enough"). */
  kind: string;
  /** How pressing it is in this state (0 = met, 1 = desperate), or null where it does not apply. */
  level(state: State, context: NeedContext): number | null;
  /**
   * How vital it is next to the others (higher = more vital; default 0). While a more vital need
   * presses at all, a lesser one is silent: staying alive comes before stocking up.
   */
  rank?: number;
  /** How much it darkens the outlook when unmet: the settings give each class its weight. Default: "body". */
  weighs?: Weighs;
  /** How much of the thing is enough, for a need that is about having some (the level is how far short of it the bot is). */
  target?: number;
  /** When it presses in full: a need of the night presses less by day, one of the day less by night. Default: always. */
  by?: "day" | "night";
  /** Something to do when all is well (stocking up, looking about): it presses less under stress. Default: false. */
  spare?: boolean;
  /** For a need about having some of a thing: the need of the body it is kept for (food is kept for hunger). Running out while that one presses teaches that enough was not enough. */
  serves?: string;
  /** A level the need is known to be heading for within the minute, from something other than its own rate (a reserve run out, night about to fall), or null. */
  coming?(state: State, context: NeedContext): number | null;
  /** What a change in it is called in the log ("food 5 → 10"). Default: the two levels. */
  say?(before: State, after: State): string;
}
