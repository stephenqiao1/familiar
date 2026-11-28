// Stay or leave. The cingulate keeps a rate of progress for whatever is running (reward, steps
// finished and ground covered, a minute) and compares it with how things have been going in
// general. When the running activity has paid clearly worse than that for a while, `leave` rises.

/** What a finished step and a block of ground are worth beside reward. */
export const WORTH = { step: 0.5, block: 0.02 };
/** The running activity is not judged before it has run this long. */
export const JUDGED_AFTER_MS = 20_000;
/** How things have been going in general: an average over about this long. */
export const BACKGROUND_MS = 600_000;
/** Paying this much worse than the background (as a share of it) is where leaving begins; this much further is full. */
export const WORSE = { from: 0.3, span: 0.5 };
/** It must have been paying worse for this long to count in full. */
export const FOR_A_WHILE_MS = 60_000;

export interface Progress {
  reward: number;
  steps: number;
  ground: number;
}

/** One tick's progress as one number. */
export const payOf = (p: Progress) => Math.max(0, p.reward) + WORTH.step * p.steps + WORTH.block * p.ground;

export interface LeaveKeeper {
  /** One tick: what is running (null: nothing, or rest) and the progress made this tick. Returns `leave` and the two rates behind it, a minute. */
  tick(activity: string | null, progress: Progress, now: number): { leave: number; current: number; background: number };
}

export function createLeave(): LeaveKeeper {
  let running: { activity: string; since: number; paid: number } | null = null;
  /** A leaky total of pay over about ten minutes. */
  let total = 0;
  let last: number | null = null;
  let worseSince: number | null = null;
  return {
    tick(activity, progress, now) {
      const pay = payOf(progress);
      const dt = last === null ? 0 : Math.max(0, now - last);
      last = now;
      total = total * Math.exp(-dt / BACKGROUND_MS) + pay;
      const background = total / (BACKGROUND_MS / 60_000);
      if (activity === null || running?.activity !== activity) {
        running = activity === null ? null : { activity, since: now, paid: 0 };
        worseSince = null;
      }
      if (!running) return { leave: 0, current: 0, background };
      running.paid += pay;
      const ran = now - running.since;
      const current = ran > 0 ? running.paid / (ran / 60_000) : 0;
      const worse = background > 0 && ran >= JUDGED_AFTER_MS ? (background - current) / background : 0;
      if (worse <= WORSE.from) {
        worseSince = null;
        return { leave: 0, current, background };
      }
      worseSince ??= now;
      const leave = Math.min(1, (worse - WORSE.from) / WORSE.span) * Math.min(1, (now - worseSince) / FOR_A_WHILE_MS);
      return { leave, current, background };
    },
  };
}
