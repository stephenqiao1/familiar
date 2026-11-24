// The fast "something happened" signal: on a new winner it is that winner's strength, and it
// fades to nothing in about half a second. It says only that something stood out, before
// anything has identified it. It is not a reward and not an alarm.

/** The signal is gone this long after the winner. */
export const ORIENTING_FADE_MS = 500;

export interface Orienting {
  /** A new winner of this strength (0 to 1). */
  fire(strength: number, now: number): void;
  /** The signal right now. */
  level(now: number): number;
}

export function createOrienting(fadeMs = ORIENTING_FADE_MS): Orienting {
  let last: { strength: number; at: number } | null = null;
  return {
    fire(strength, now) {
      last = { strength: Math.min(1, Math.max(0, strength)), at: now };
    },
    level(now) {
      if (!last) return 0;
      return last.strength * Math.max(0, 1 - (now - last.at) / fadeMs);
    },
  };
}
