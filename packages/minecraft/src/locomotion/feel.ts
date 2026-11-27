import type { Vec3 } from "vec3";

/** Supposed to be moving, but covered less than this many blocks in this long: stuck. */
export const STUCK = { blocks: 0.5, ms: 1500 };

/**
 * Feels whether the feet are getting anywhere. Feed it the position about four times a second
 * while travelling; `expected` says whether the body is supposed to be moving right now
 * (not standing on purpose, not digging). `scale` moves the allowance with the body's pace here
 * (under 1 on slow ground, where less ground is covered in the time).
 */
export function createStuckSense(): { feel(pos: Vec3, expected: boolean, now: number, scale?: number): boolean; reset(): void } {
  let samples: { pos: Vec3; at: number }[] = [];
  return {
    feel(pos, expected, now, scale = 1) {
      if (!expected) {
        samples = [];
        return false;
      }
      samples.push({ pos: pos.clone(), at: now });
      // Keep one sample older than the window, so the window is always fully covered.
      while (samples.length > 1 && now - samples[1]!.at >= STUCK.ms) samples.shift();
      const oldest = samples[0]!;
      if (now - oldest.at < STUCK.ms) return false;
      return samples.every((s) => s.pos.distanceTo(pos) < STUCK.blocks * scale);
    },
    reset() {
      samples = [];
    },
  };
}

/** A local correction, tried before the layer above is told. */
export type Recovery = "jump" | "sidestep" | "replan";

/** Local corrections are tried this many times before giving up as stuck. */
export const MAX_RECOVERIES = 3;
const ORDER: Recovery[] = ["jump", "sidestep", "replan"];

/**
 * The recovery to try on the nth attempt (0-based), or null when the tries are used up. A journey
 * that cannot afford to fiddle (urgent, or not walking) only ever plans again.
 */
export function recoveryFor(attempt: number, plainWalk: boolean): Recovery | null {
  if (attempt >= MAX_RECOVERIES) return null;
  return plainWalk ? ORDER[attempt]! : "replan";
}
