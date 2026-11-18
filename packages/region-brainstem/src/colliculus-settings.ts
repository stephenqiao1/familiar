// One bot's colliculus: what makes something striking, how easily it turns its head, and how
// strong each part is.

/** The physical features a thing is scored on. Never what kind of thing it is. */
export const FEATURES = ["suddenness", "motion", "looming", "nearness", "loudness", "touch"] as const;
export type Feature = (typeof FEATURES)[number];
/** How much of each feature a thing shows right now, each 0 to 1. */
export type Features = Record<Feature, number>;

export interface ColliculusSettings {
  /** How much each feature adds to salience. Change what makes something striking here. */
  weights: Features;
  /** What a thing's salience must beat to win a look. Low: a jumpy bot. High: an unbothered one. */
  threshold: number;
  /** How much what is seen counts (0: blind to it), 0 to 1. */
  sight: number;
  /** How much what is heard counts. */
  hearing: number;
  /** How much something closing fast counts, and whether it is shared as the `looming` signal. */
  looming: number;
  /** Bias from above: the goal's watched kinds get a boost, and alarm, arousal and a demanding skill move the threshold. */
  topDown: number;
  /** Getting used to a harmless thing, and not looking straight back at what was just looked at. */
  habituation: number;
  /** Glancing around when nothing stands out. */
  scanning: number;
  /** The deciding layers are told only what is seen or heard (off by default). */
  fieldOfView: number;
}

/**
 * The weights: looming counts most among what is seen, and touch beats everything. With the
 * default threshold a still thing never wins by being near; something that appears, starts to
 * move, changes, comes fast or is loud does.
 */
export const DEFAULT_COLLICULUS: ColliculusSettings = {
  weights: { suddenness: 0.5, motion: 0.3, looming: 1, nearness: 0.25, loudness: 0.6, touch: 3 },
  threshold: 0.45,
  sight: 1,
  hearing: 1,
  looming: 1,
  topDown: 1,
  habituation: 1,
  scanning: 1,
  fieldOfView: 0,
};

const STRENGTHS = ["sight", "hearing", "looming", "topDown", "habituation", "scanning", "fieldOfView"] as const;

/** What is wrong with the settings, or null if they are fine. */
export function colliculusProblem(s: ColliculusSettings): string | null {
  for (const feature of FEATURES) if (!(s.weights?.[feature] >= 0)) return `colliculus.weights.${feature} must be 0 or more, got ${s.weights?.[feature]}`;
  const extra = Object.keys(s.weights).find((key) => !(FEATURES as readonly string[]).includes(key));
  if (extra) return `colliculus.weights.${extra} is not a feature (use: ${FEATURES.join(", ")})`;
  if (!(s.threshold > 0)) return `colliculus.threshold must be above 0, got ${s.threshold}`;
  for (const key of STRENGTHS) if (!(s[key] >= 0 && s[key] <= 1)) return `colliculus.${key} must be 0 to 1, got ${s[key]}`;
  return null;
}
