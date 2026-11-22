import { PATIENCE_MAX, PATIENCE_MIN, type PatienceSettings } from "./settings.js";

/** The workspace signals that carry patience and the outlook it follows. */
export const PATIENCE_SIGNAL = "patience";
export const OUTLOOK_SIGNAL = "outlook";
/** The outlook's change over this long nudges patience. */
const TREND_WINDOW_MS = 30_000;
/** The most the trend can nudge patience, either way. */
const MAX_TREND_NUDGE = 0.1;
/** Patience falls to a worse outlook over about this long: trust is lost fast and won back slowly. */
export const FALL_SECONDS = 3;

/** A need as the outlook reads it: how pressing it is (0 to 1), and how much it darkens the outlook when unmet (1 = in full). */
export interface OutlookNeed {
  level: number;
  weight: number;
}

/**
 * How good the near future looks (0 to 1), from the bot's own needs: 1 / (1 + the cost of how
 * things stand). The cost is each need's weighted level squared, the same curve its reward
 * follows. One ordinary need at its worst gives 0.5, each further trouble lowers it, and none of
 * them is watered down by the ones that are fine. With no needs known there is no outlook (null).
 */
export function outlookFrom(needs: readonly OutlookNeed[]): number | null {
  if (!needs.length) return null;
  return 1 / (1 + needs.reduce((cost, n) => cost + (n.weight * n.level) ** 2, 0));
}

/**
 * Patience (0.05 to 0.95), modelled on serotonin: a slow average of the outlook ("how good does
 * the near future look?", 0 to 1), nudged by whether the outlook is rising or falling. It falls
 * to a worse outlook within seconds and climbs back to a better one over the bot's time
 * constant. With no outlook it drifts back to the bot's resting level.
 */
export interface Patience {
  /** Feeds the outlook at time `at` (ms), or null for no input; returns the new patience. */
  update(outlook: number | null, at: number): number;
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
      const toward = outlook ?? settings.resting;
      const over = outlook !== null && toward < slow ? Math.min(FALL_SECONDS, settings.timeConstantSeconds) : settings.timeConstantSeconds;
      slow = clamp(slow + (toward - slow) * Math.min(1, dt / over));
      history = outlook === null ? [] : [...history.filter((h) => at - h.at <= TREND_WINDOW_MS), { at, outlook }];
      const trend = outlook === null ? 0 : outlook - history[0]!.outlook;
      nudge = Math.min(MAX_TREND_NUDGE, Math.max(-MAX_TREND_NUDGE, trend));
      return clamp(slow + nudge);
    },
    level: () => clamp(slow + nudge),
  };
}
