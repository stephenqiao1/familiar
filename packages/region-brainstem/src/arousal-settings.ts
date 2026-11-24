/** One bot's arousal: how awake it rests, how it sleeps and wakes, and how far arousal reaches. Each 0 to 1. */
export interface ArousalSettings {
  /** The awake baseline: where arousal sits with nothing pushing it. */
  resting: number;
  /** How strongly tiredness and night make the bot sleepy (0: never sleepy). */
  sleepPressure: number;
  /** Going to bed by itself when sleepy: scales that proposal's urgency (0: never proposes bed). */
  bedtime: number;
  /** How much it takes to wake it: 0.5 is usual, higher is a heavier sleeper. */
  wakeThreshold: number;
  /** How groggy it is after a calm waking (0: wide awake at once). */
  inertia: number;
  /** How far low arousal slows the deciding layers (0: they always run at full rate, asleep too). */
  gate: number;
  /** A long, safe, still, drowsy spell counts as rest (memories are consolidated). On above 0. */
  quietRest: number;
  /** Over-arousal narrows what the deciding layers are offered. On above 0. */
  frazzled: number;
  /** How far slow stress keeps the bot from getting sleepy (0: not at all). */
  stress: number;
  /** Something that just drew the eye (the colliculus's `orienting`) counts as novelty and pushes arousal up a little. On above 0. */
  orienting: number;
}

export const DEFAULT_AROUSAL: ArousalSettings = { resting: 0.5, sleepPressure: 1, bedtime: 1, wakeThreshold: 0.5, inertia: 1, gate: 1, quietRest: 1, frazzled: 1, stress: 1, orienting: 1 };

const KEYS = ["resting", "sleepPressure", "bedtime", "wakeThreshold", "inertia", "gate", "quietRest", "frazzled", "stress", "orienting"] as const;

/** What is wrong with the settings, or null if they are fine. */
export function arousalProblem(s: ArousalSettings): string | null {
  for (const key of KEYS) if (!(s[key] >= 0 && s[key] <= 1)) return `arousal.${key} must be 0 to 1, got ${s[key]}`;
  return null;
}
