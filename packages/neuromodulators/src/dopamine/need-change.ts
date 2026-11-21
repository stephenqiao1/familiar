/**
 * The reward for a need moving from `before` to `after` (both 0 = satisfied .. 1 = desperate):
 * before² − after². It is signed: a need that falls pays, and one that rises costs exactly what
 * falling back will pay. So nothing that goes round in a circle (hurt and healed, lost and found,
 * out of the light and back) comes out ahead, and a slow climb out of trouble is paid in full,
 * step by step. The square makes a change count for more the worse things are: bread is worth a
 * lot when starving and little when nearly full.
 */
export function needChangeReward(before: number, after: number): number {
  return before * before - after * after;
}
