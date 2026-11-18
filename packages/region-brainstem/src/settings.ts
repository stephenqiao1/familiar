/** One bot's brainstem temperament. Each sub-part is a strength from 0 (off) to 1 (full). */
export interface BrainstemSettings {
  /** 0 (timid) to 1 (brave): brave bots flee less readily and fight more readily by reflex. */
  bravery: number;
  /** a: how far alarm and bravery move the strength of soft reflexes (0 = every gain is 1). */
  gains: number;
  /** b: startle: how big a flinch a sudden event gives. Multiplies its size: 0 never startles, 1 normal, up to 1.5 jumpy. */
  startle: number;
  /** b: how far being on edge (alarm, soreness, the dark, a bad place) enlarges a startle. */
  potentiation: number;
  /** b: how far having seen it coming shrinks a startle. */
  warning: number;
  /** b: how far getting used to a harmless repeat shrinks a startle. */
  habituation: number;
  /** b: no startle for what the bot did itself. On above 0. */
  selfCaused: number;
  /** b: a full startle releases a response the goal marked `onStartle`. On above 0. */
  startReact: number;
  /** d: responses the goal loaded in advance fire on sight. On above 0. */
  loadedResponses: number;
  /** d: how far a goal can hold a soft reflex back (0 = not at all, 1 = down to 0.3 of its gain). */
  holdBack: number;
  /** e: while asleep and undisturbed, the deciding layers above are paused. On above 0. */
  arousalGate: number;
  /** f: share stuck and sore as signals. On above 0. */
  bodySignals: number;
}

export const DEFAULT_BRAINSTEM: BrainstemSettings = {
  bravery: 0.5,
  gains: 1,
  startle: 1,
  potentiation: 1,
  warning: 1,
  habituation: 1,
  selfCaused: 1,
  startReact: 1,
  loadedResponses: 1,
  holdBack: 1,
  arousalGate: 1,
  bodySignals: 1,
};

/** A jumpy bot startles this much harder than a normal one. */
const MAX_STARTLE = 1.5;
const KEYS = ["bravery", "gains", "potentiation", "warning", "habituation", "selfCaused", "startReact", "loadedResponses", "holdBack", "arousalGate", "bodySignals"] as const;

/** What is wrong with the settings, or null if they are fine. */
export function brainstemProblem(s: BrainstemSettings): string | null {
  if (!(s.startle >= 0 && s.startle <= MAX_STARTLE)) return `brainstem.startle must be 0 to ${MAX_STARTLE} (0 never startles, 1 normal, ${MAX_STARTLE} jumpy), got ${s.startle}`;
  for (const key of KEYS) if (!(s[key] >= 0 && s[key] <= 1)) return `brainstem.${key} must be 0 to 1, got ${s[key]}`;
  return null;
}
