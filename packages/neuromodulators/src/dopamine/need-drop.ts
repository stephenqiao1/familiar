/**
 * The reward for a need falling from `before` to `after` (both 0 = satisfied .. 1 = desperate):
 * how far it fell, scaled by how big it was. Bread is worth a lot when starving, little when full.
 * A need that rose or stayed the same gives 0.
 */
export function needDropReward(before: number, after: number): number {
  return Math.max(0, before - after) * before;
}
