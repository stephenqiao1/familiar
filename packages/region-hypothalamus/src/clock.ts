// The body clock: where in the day it is, and what that does to what presses. Pure and game-free.

/** What the game says about the time of day. */
export interface DayTime {
  /** How far through the whole day it is, 0 to 1 (0 at sunrise). */
  phase: number;
  /** The phase at which night begins. */
  nightFrom: number;
  /** How long the whole day lasts, in seconds. */
  daySeconds: number;
}

export const CLOCK = {
  /** Dusk is the last stretch of the day, and dawn the last of the night, this long. */
  twilightSeconds: 180,
  /** A need at the wrong time of day presses this much less (rest by day, looking about by night). */
  offShare: 0.5,
};

const clamp = (n: number) => Math.min(1, Math.max(0, n));

export interface Clock {
  phase: number;
  night: boolean;
  /** How far through the night, 0 to 1 (0 by day). */
  nightProgress: number;
  /** 0 until three minutes before night, rising to 1 as night begins; 0 again by night. */
  dusk: number;
  /** The same for the end of the night. */
  dawn: number;
}

export function readClock({ phase, nightFrom, daySeconds }: DayTime): Clock {
  const p = clamp(phase);
  const night = p >= nightFrom;
  const twilight = CLOCK.twilightSeconds / daySeconds;
  return {
    phase: p,
    night,
    nightProgress: night ? clamp((p - nightFrom) / (1 - nightFrom)) : 0,
    dusk: night ? 0 : clamp(1 - (nightFrom - p) / twilight),
    dawn: night ? clamp(1 - (1 - p) / twilight) : 0,
  };
}

/** How much of its full press a need has at this time of day (1: all of it). Day fades into night over dusk, and back over dawn. */
export function clockGain(by: "day" | "night" | undefined, clock: Clock | null, strength: number): number {
  if (!by || !clock || strength <= 0) return 1;
  const daylight = clock.night ? clock.dawn : 1 - clock.dusk;
  return 1 - strength * CLOCK.offShare * (by === "night" ? daylight : 1 - daylight);
}
