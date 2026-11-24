import type { Feature } from "./colliculus-settings.js";

// Sight in the dark: a thing in darkness stands out less than one in daylight. What a still
// thing shows (how near it is) is lost most; movement and looming are lost least, as an eye
// still catches motion in poor light. Sound and touch are never scaled.

/** The share of each sight feature that is lost in complete darkness. */
export const LOST_IN_DARK: Partial<Record<Feature, number>> = { nearness: 0.8, suddenness: 0.5, motion: 0.3, looming: 0.2 };

/** How much of a sight feature is left with `light` (0 dark to 1 daylight) where the thing stands. `strength` 0: light does not matter. */
export function leftInLight(feature: Feature, light: number, strength: number): number {
  const dark = 1 - Math.min(1, Math.max(0, light));
  return 1 - strength * (LOST_IN_DARK[feature] ?? 0) * dark;
}
