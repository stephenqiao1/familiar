export { createLocomotion, type LocomotionOptions } from "./controller.js";
export { createRouteQueries } from "./route-queries.js";
import type { SkillResult } from "@familiar/contracts";

/** A skill's result, carrying the report of the journey that was part of it. */
export function withJourney(result: SkillResult, journey: SkillResult): SkillResult {
  return journey.changes ? { ...result, changes: { ...journey.changes, ...result.changes } } : result;
}

export type { AwayOptions, Drive, FollowOptions, Gait, GoToOptions, HeadOverride, Locomotion, LocomotionStatus, PatternName, Place } from "./types.js";
