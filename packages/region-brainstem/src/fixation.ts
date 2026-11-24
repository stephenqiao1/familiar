// Holding the gaze on the task (the brake the basal ganglia keep on the colliculus). While the
// running skill is aimed at a thing, that thing is fixated: anything else must beat the
// threshold by an extra amount to pull the head away, unless it is pressing (touch, or strong
// looming). Make a bot more or less distractible here.

/** The extra a distraction must beat while something is fixated, and the most the threshold may be raised in all. */
export const BRAKE = { extra: 0.3, most: 0.4 };

/**
 * The extra for things other than the fixated one. `raised` is what a demanding skill has
 * already added to the threshold: the two together never exceed `BRAKE.most`.
 */
export function brakeOf(fixating: boolean, raised: number, strength: number): number {
  if (!fixating || strength <= 0) return 0;
  return Math.max(0, Math.min(BRAKE.extra * strength, BRAKE.most - raised));
}
