import type { EndedEpisode } from "./episodes.js";

/** The rule name wasted effort is logged under, beside the other rewards. */
export const WASTED_EFFORT_RULE = "wasted_effort";
/** The most one run can be charged for wasted effort, however long it went on. */
export const MAX_WASTE = 0.5;

/**
 * Wasted effort: what a run that came to little costs, as a negative reward. It is the work put
 * in (in reward units, capped at MAX_WASTE) less what the run earned, so a run that paid for its
 * effort wastes nothing, and a long hard run for nothing costs more than a short easy one.
 *
 * Only a run that was expected to pay (`expected` above 0) can be wasted: going somewhere on
 * purpose with no reward in mind is not a disappointment. A run cut short by something else, or
 * by death, is not charged either: it never got to find out.
 */
export function wastedEffort(episode: Pick<EndedEpisode, "effort" | "gained" | "ended" | "fatal">, expected: number): number {
  if (episode.ended === "interrupted" || episode.fatal || !(expected > 0)) return 0;
  return Math.max(0, Math.min(MAX_WASTE, episode.effort) - episode.gained);
}
