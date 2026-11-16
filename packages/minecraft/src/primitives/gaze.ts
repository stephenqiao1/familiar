import type { Vec3 } from "vec3";
import { sleepFor } from "../abort.js";
import type { Locomotion } from "../locomotion/index.js";

// Looking one way while walking another. Movement keys are relative to where the head faces, so
// a held look can take the head while the legs keep their direction: the same direction of
// travel is pressed as a combination of forward, back, left and right around the new facing.
// This file only decides where to look and which keys that takes; the locomotion controller
// knows whether the bot is walking plainly and which way, and presses the keys.

const EIGHTH = Math.PI / 4;

/**
 * The keys that walk in a direction `angle` radians to the left of where the head faces, as one
 * of the eight combinations (so the angle is snapped to the nearest 45 degrees).
 */
export function keysFor(angle: number): { forward: boolean; back: boolean; left: boolean; right: boolean } {
  const eighth = ((Math.round(angle / EIGHTH) % 8) + 8) % 8;
  return { forward: [7, 0, 1].includes(eighth), left: [1, 2, 3].includes(eighth), back: [3, 4, 5].includes(eighth), right: [5, 6, 7].includes(eighth) };
}

/**
 * Keys can only walk in eight directions, so a direction between two of them is walked by
 * switching between its two neighbours tick by tick, carrying the error over: the average
 * heading is the true one. Returns the snapped angle to use this tick.
 */
export function createDither(): (angle: number) => number {
  let carried = 0;
  return (angle) => {
    const snapped = Math.round((angle + carried) / EIGHTH) * EIGHTH;
    carried += angle - snapped;
    return snapped;
  };
}

/**
 * Keeps the head on a point while the bot walks, until the returned function is called. `eye`
 * says where the bot's eyes are; `point` is asked every tick, so it can follow something that
 * moves (null lets go for that tick).
 */
export function holdGaze(locomotion: Locomotion, eye: () => Vec3, point: () => Vec3 | null): () => void {
  const dither = createDither();
  locomotion.setHeadOverride((travelYaw) => {
    const target = point();
    if (!target) return null;
    const to = target.minus(eye());
    const yaw = Math.atan2(-to.x, -to.z);
    // Yaw grows to the left, so this is how far left of the gaze the legs are heading.
    return { yaw, pitch: Math.atan2(to.y, Math.hypot(to.x, to.z)), keys: keysFor(dither(travelYaw - yaw)) };
  });
  return () => locomotion.setHeadOverride(null);
}

/** Holds the head on a point for `ms` while walking, then gives it back. Always lets go. */
export async function doGaze(locomotion: Locomotion, eye: () => Vec3, point: () => Vec3 | null, ms: number, signal: AbortSignal): Promise<void> {
  const release = holdGaze(locomotion, eye, point);
  try {
    await sleepFor(ms, signal);
  } finally {
    release();
  }
}
