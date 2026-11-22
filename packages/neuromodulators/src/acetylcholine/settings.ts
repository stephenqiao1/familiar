/** One bot's focus temperament. Each effect is 0 (off) or 1 (on). */
export interface FocusSettings {
  /** Where focus rests with nothing moving it (0.05 to 0.95): high is watchful, low is easy-going. */
  resting: number;
  /** How slowly focus moves, in seconds. */
  timeConstantSeconds: number;
  /** How long trust in a remembered thing takes to halve, in minutes: short double-checks, long assumes. */
  trustHalfLifeMinutes: number;
  /** How many agreeing memories a general fact needs: low is quick to generalise, high is cautious. */
  factSupport: number;
  /** Effect a: remembered values are used only while their trust is above focus. */
  sensesVsMemory: number;
  /** Effect b: focus sets how much nearby detail and how much remembered material is taken in. */
  attention: number;
  /** Effect c: focus scales how strongly new memories start. */
  memoryWrite: number;
  /** Effect d: memories are consolidated while resting safely. */
  consolidation: number;
  /** Effect e: spotting something the bot was looking for is a cue to act on it at once. */
  cuePulse: number;
  /** Effect f: skill values are only fully updated shortly after a notable event. */
  learningWindow: number;
}

export const FOCUS_MIN = 0.05;
export const FOCUS_MAX = 0.95;
export const DEFAULT_FOCUS: FocusSettings = {
  resting: 0.5,
  timeConstantSeconds: 45,
  trustHalfLifeMinutes: 10,
  factSupport: 3,
  sensesVsMemory: 1,
  attention: 1,
  memoryWrite: 1,
  consolidation: 1,
  cuePulse: 1,
  learningWindow: 1,
};

const EFFECTS = ["sensesVsMemory", "attention", "memoryWrite", "consolidation", "cuePulse", "learningWindow"] as const;

/** What is wrong with the settings, or null if they are fine. */
export function focusProblem(s: FocusSettings): string | null {
  if (!(s.resting >= FOCUS_MIN && s.resting <= FOCUS_MAX)) return `focus.resting must be ${FOCUS_MIN} to ${FOCUS_MAX}, got ${s.resting}`;
  if (!(s.timeConstantSeconds > 0)) return `focus.timeConstantSeconds must be above 0, got ${s.timeConstantSeconds}`;
  if (!(s.trustHalfLifeMinutes > 0)) return `focus.trustHalfLifeMinutes must be above 0, got ${s.trustHalfLifeMinutes}`;
  if (!(Number.isInteger(s.factSupport) && s.factSupport >= 2)) return `focus.factSupport must be a whole number of 2 or more, got ${s.factSupport}`;
  for (const effect of EFFECTS) if (!(s[effect] >= 0 && s[effect] <= 1)) return `focus.${effect} must be 0 to 1, got ${s[effect]}`;
  return null;
}
