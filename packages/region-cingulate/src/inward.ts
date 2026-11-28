import type { Verdict } from "@familiar/contracts";

// Looking inward: the mode of a mind at rest. It holds while the body is in quiet rest, there is
// next to no trouble and the verdict is to carry on, and it ends on the tick any of the three fails.

/** The signal shared while the bot is looking inward (1 or 0). */
export const INWARD_SIGNAL = "inward";
/** Trouble under this is near enough to none. */
export const INWARD_UNDER = 0.1;

export function inwardNow(now: { quiet: boolean; trouble: number; verdict: Verdict }): boolean {
  return now.quiet && now.trouble < INWARD_UNDER && now.verdict === "carry on";
}

export interface InwardKeeper {
  /** Whether it is inward this tick; returns when this spell began, or null when not inward. */
  tick(inward: boolean, now: number): number | null;
}

/** Keeps when the inward spell began, so each spell can be told from the next. */
export function createInward(): InwardKeeper {
  let since: number | null = null;
  return {
    tick(inward, now) {
      since = inward ? (since ?? now) : null;
      return since;
    },
  };
}
