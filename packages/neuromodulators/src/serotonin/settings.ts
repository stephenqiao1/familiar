/** One bot's patience temperament. Each effect strength is 0 (off) to 1 (full); above 1 exaggerates it. */
export interface PatienceSettings {
  /** Where patience rests with no input (0.05 to 0.95). */
  resting: number;
  /** How slowly patience follows the outlook, in seconds. */
  timeConstantSeconds: number;
  /** Effect a: how much patience stretches or shrinks the time before giving up on a skill. */
  persistence: number;
  /** Effect b: how much patience shapes the planner's horizon. */
  horizon: number;
  /** Effect c: how much patience holds back risky skills. */
  brake: number;
}

export const PATIENCE_MIN = 0.05;
export const PATIENCE_MAX = 0.95;
export const DEFAULT_PATIENCE: PatienceSettings = { resting: 0.5, timeConstantSeconds: 60, persistence: 1, horizon: 1, brake: 1 };

/** What is wrong with the settings, or null if they are fine. */
export function patienceProblem(s: PatienceSettings): string | null {
  if (!(s.resting >= PATIENCE_MIN && s.resting <= PATIENCE_MAX)) return `patience.resting must be ${PATIENCE_MIN} to ${PATIENCE_MAX}, got ${s.resting}`;
  if (!(s.timeConstantSeconds > 0)) return `patience.timeConstantSeconds must be above 0, got ${s.timeConstantSeconds}`;
  for (const effect of ["persistence", "horizon", "brake"] as const) {
    if (!(s[effect] >= 0)) return `patience.${effect} must be 0 or more, got ${s[effect]}`;
  }
  return null;
}
