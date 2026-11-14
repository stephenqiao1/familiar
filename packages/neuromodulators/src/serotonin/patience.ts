import { PATIENCE_MAX, PATIENCE_MIN, type PatienceSettings } from "./settings.js";

/** The workspace signals that carry patience and the outlook it follows. */
export const PATIENCE_SIGNAL = "patience";
export const OUTLOOK_SIGNAL = "outlook";
/** The outlook's change over this long nudges patience. */
const TREND_WINDOW_MS = 30_000;
/** The most the trend can nudge patience, either way. */
const MAX_TREND_NUDGE = 0.1;
/** How much sudden danger cuts patience at once. */
const SHOCK_DROP = 0.2;

/**
 * Patience (0.05 to 0.95), modelled on serotonin: a slow average of the outlook ("how good does
 * the near future look?", 0 to 1), nudged by whether the outlook is rising or falling. With no
 * outlook it drifts back to the bot's resting level. Sudden danger cuts it at once.
 */
export interface Patience {
  /** Feeds the outlook at time `at` (ms), or null for no input; returns the new patience. */
  update(outlook: number | null, at: number): number;
  /** Sudden danger: cuts patience by 0.2 now. */
  shock(): void;
  level(): number;
}

export function createPatience(settings: Pick<PatienceSettings, "resting" | "timeConstantSeconds">): Patience {
  /** The slow average, before the trend nudge. */
  let slow = settings.resting;
  let nudge = 0;
  let last: number | null = null;
  let history: { at: number; outlook: number }[] = [];
  const clamp = (n: number) => Math.min(PATIENCE_MAX, Math.max(PATIENCE_MIN, n));

  return {
    update(outlook, at) {
      const dt = last === null ? 0 : Math.max(0, at - last) / 1000;
      last = at;
      const step = Math.min(1, dt / settings.timeConstantSeconds);
      slow = clamp(slow + ((outlook ?? settings.resting) - slow) * step);
      history = outlook === null ? [] : [...history.filter((h) => at - h.at <= TREND_WINDOW_MS), { at, outlook }];
      const trend = outlook === null ? 0 : outlook - history[0]!.outlook;
      nudge = Math.min(MAX_TREND_NUDGE, Math.max(-MAX_TREND_NUDGE, trend));
      return clamp(slow + nudge);
    },
    shock() {
      slow = clamp(slow - SHOCK_DROP);
    },
    level: () => clamp(slow + nudge),
  };
}
