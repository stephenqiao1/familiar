import type { ModelStore, Movement } from "./model.js";
import { widthOf } from "./mismatch.js";
import { predict } from "./predict.js";
import type { CerebellumSettings } from "./settings.js";

// Timing: when one event is known to lead to another, how long the second takes to follow.
// Each pair is learned like any movement (kind "timing", measure "seconds"), so the learning,
// the trust and the forgetting are the same. Add a source of pairs or events on the game's side.

/** A sign is waited on no longer than this. */
const WAIT_MS = 120_000;
/** Something is due from this long before its earliest usual time. */
const LEAD_MS = 2000;
export const TIMING = "timing";

export interface Due {
  /** The event that was the sign, and the one that is due. */
  sign: string;
  what: string;
  /** Seconds until its usual time (negative: overdue, but still inside its spread). */
  inSeconds: number;
}

export interface Timing {
  /** An event happened. Returns what it teaches: the delay since each sign it is known to follow. */
  event(label: string, at: number): Movement[];
  /** What is due about now, from the trusted delays of the signs still waited on. */
  due(now: number): Due[];
}

/** `pairs`: the known "leads to" pairs, each as [sign, what follows]. */
export function createTiming(options: { store: ModelStore; pairs(): readonly (readonly [string, string])[]; settings: CerebellumSettings }): Timing {
  const { store, settings } = options;
  const waiting = new Map<string, number>();
  return {
    event(label, at) {
      const pairs = options.pairs();
      const out: Movement[] = [];
      for (const [sign, then] of pairs) {
        const since = waiting.get(sign);
        if (then !== label || since === undefined || at - since > WAIT_MS || at <= since) continue;
        out.push({ kind: TIMING, name: `${sign}>${then}`, keys: [""], measures: { seconds: (at - since) / 1000 }, at });
        waiting.delete(sign);
      }
      if (pairs.some(([sign]) => sign === label)) waiting.set(label, at);
      return out;
    },
    due(now) {
      if (settings.timing <= 0) return [];
      const out: Due[] = [];
      for (const [sign, then] of options.pairs()) {
        const since = waiting.get(sign);
        if (since === undefined || now - since > WAIT_MS) continue;
        const p = predict(store, TIMING, `${sign}>${then}`, [""], "seconds", now, settings);
        if (!p) continue;
        const [usual, slack] = [since + p.value * 1000, 3 * widthOf(p.value, p.spread) * 1000];
        if (now >= usual - slack - LEAD_MS && now <= usual + slack) out.push({ sign, what: then, inSeconds: Math.round((usual - now) / 100) / 10 });
      }
      return out;
    },
  };
}
