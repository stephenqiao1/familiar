// Stress: the slow cost of strain. It builds over about a minute while the body is under load
// and takes about five to fade, so it is still there when the cause has gone. Pure and game-free.

export const STRESS = {
  /** Time constants: up under load, down once it lifts. */
  buildSeconds: 60,
  fadeSeconds: 300,
  /** Under stress, a need that can wait (stocking up, looking about) presses down to this much less. */
  spareOff: 0.5,
};

/** What loads the body, each 0 to 1. */
export interface Load {
  /** The fast alarm of the moment. */
  alarm: number;
  /** A threat coming or on the body. */
  threat: number;
  pain: number;
  /** How poor the vital signs are (1 − the medulla's overall number). */
  poorVitals: number;
  /** Fear: harm predicted by what is around, before any has come (the amygdala's). Default: none. */
  fear?: number;
}

/**
 * The load right now, and what set it: the largest of its sources, not their sum. Alarm already
 * follows threat and health, so adding them would count one cause two or three times.
 */
export function loadOf(load: Load): { value: number; by: string } {
  const [by, value] = (Object.entries(load) as [string, number][]).sort((a, b) => b[1] - a[1])[0]!;
  return { value: Math.min(1, Math.max(0, value)), by: value > 0 ? by : "nothing" };
}

export interface Stress {
  /** Moves stress toward the load at time `now` (ms); returns the new level. */
  update(load: number, now: number): number;
  reset(): void;
}

export function createStress(): Stress {
  let level = 0;
  let last: number | null = null;
  return {
    update(load, now) {
      const seconds = last === null ? 0 : Math.max(0, now - last) / 1000;
      last = now;
      const tau = load > level ? STRESS.buildSeconds : STRESS.fadeSeconds;
      level = load + (level - load) * Math.exp(-seconds / tau);
      return level;
    },
    reset() {
      level = 0;
      last = null;
    },
  };
}

/** How much of its full press a need that can wait has under this much stress. */
export function stressGain(spare: boolean | undefined, stress: number, strength: number): number {
  return spare ? 1 - strength * STRESS.spareOff * Math.min(1, Math.max(0, stress)) : 1;
}
