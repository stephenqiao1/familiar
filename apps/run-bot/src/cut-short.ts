/**
 * Why the running skill must end as failed, or null if it need not: a protective reflex is
 * cutting it short. The skill is switched off as a failure that names the reflex and the place,
 * so the scorebook learns that it cost something here (an interruption teaches it nothing).
 */
export function cutShortReason(next: string, running: string | undefined, reflexSkills: readonly string[], at: { x: number; y: number; z: number }): string | null {
  if (running === undefined || !reflexSkills.includes(next) || reflexSkills.includes(running)) return null;
  return `cut short by ${next} at ${at.x},${at.y},${at.z}`;
}
