/** One bot's brainstem temperament. Each sub-part is a strength from 0 (off) to 1 (full). */
export interface BrainstemSettings {
  /** 0 (timid) to 1 (brave): brave bots flee less readily and fight more readily by reflex. */
  bravery: number;
  /** a: how far alarm and bravery move the strength of soft reflexes (0 = every gain is 1). */
  gains: number;
  /** b: startle: brace and raise alarm on a sudden event. On above 0. */
  startle: number;
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
  loadedResponses: 1,
  holdBack: 1,
  arousalGate: 1,
  bodySignals: 1,
};

const KEYS = ["bravery", "gains", "startle", "loadedResponses", "holdBack", "arousalGate", "bodySignals"] as const;

/** What is wrong with the settings, or null if they are fine. */
export function brainstemProblem(s: BrainstemSettings): string | null {
  for (const key of KEYS) if (!(s[key] >= 0 && s[key] <= 1)) return `brainstem.${key} must be 0 to 1, got ${s[key]}`;
  return null;
}
