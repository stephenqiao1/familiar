// Looking ahead: a need that is rising presses before it arrives. Pure and game-free.

export const AHEAD = {
  /** How far ahead the body looks, and the stretch of the past its rate is read from. */
  seconds: 60,
  /** A need a minute away presses this much of what it would if it were here. */
  share: 0.7,
  /** While a skill that relieves a need runs, the need presses this much less: the drive eases before the body is refilled. */
  easing: 1 / 3,
  /** Samples closer together than this are not kept. */
  sampleMs: 1000,
};

/** Keeps each need's recent levels, and says where it is heading. */
export interface LookAhead {
  /** Records `level` at `now` (ms) and returns the level expected in a minute: at the rate of the last one, or `coming` (what is known to be on its way) if that is more. Never below `level`, never above 1. */
  project(need: string, level: number, now: number, coming?: number | null): number;
  /** Forgets everything (a new body). */
  reset(): void;
}

export function createLookAhead(): LookAhead {
  const history = new Map<string, { at: number; level: number }[]>();
  return {
    project(need, level, now, coming = null) {
      const past = (history.get(need) ?? []).filter((s) => now - s.at <= AHEAD.seconds * 1000);
      if (!past.length || now - past.at(-1)!.at >= AHEAD.sampleMs) past.push({ at: now, level });
      history.set(need, past);
      const oldest = past[0]!;
      const seconds = (now - oldest.at) / 1000;
      // Too little of the past to read a rate from: only what is known to be coming counts yet.
      const rise = seconds < AHEAD.sampleMs / 1000 ? 0 : Math.max(0, (level - oldest.level) / seconds) * AHEAD.seconds;
      return Math.min(1, Math.max(level + rise, coming ?? 0));
    },
    reset: () => history.clear(),
  };
}

/** How hard a need presses given where it is heading: its level, or a share of the projection if that is more. `strength` 0: the level. */
export function pressesAt(level: number, projected: number, strength: number): number {
  return Math.max(level, strength * AHEAD.share * projected);
}
