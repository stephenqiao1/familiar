import { FEATURES, type ColliculusSettings, type Features } from "./colliculus-settings.js";
import { leftInLight } from "./darkness.js";

// The map's arithmetic: how striking a thing is, from its physical features alone.

/** How a thing reached the map. */
export type Sense = "sight" | "sound" | "touch";

/**
 * Each feature's share of a thing's salience, after the weights and the bot's strengths. `light`
 * (0 dark to 1 daylight) is how well lit the thing is: it scales what is seen, never what is
 * heard or felt.
 */
export function partsOf(features: Features, via: Sense, settings: ColliculusSettings, light = 1): Features {
  const sense = via === "sight" ? settings.sight : via === "sound" ? settings.hearing : 1;
  const parts = {} as Features;
  for (const feature of FEATURES) {
    const strength = feature === "touch" ? 1 : feature === "looming" ? sense * settings.looming : sense;
    const lit = via === "sight" && settings.darkness > 0 ? leftInLight(feature, light, settings.darkness) : 1;
    parts[feature] = settings.weights[feature] * Math.min(1, Math.max(0, features[feature])) * strength * lit;
  }
  return parts;
}

/**
 * salience = suddenness + motion + looming + nearness + loudness + touch, each weighted. It is
 * given the features and nothing else: what kind of thing it is cannot enter here.
 */
export function salienceOf(features: Features, via: Sense, settings: ColliculusSettings): number {
  const parts = partsOf(features, via, settings);
  return FEATURES.reduce((sum, feature) => sum + parts[feature], 0);
}
