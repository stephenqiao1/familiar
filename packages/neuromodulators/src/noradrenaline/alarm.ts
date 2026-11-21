/**
 * Alarm (0 to 1), the fast noradrenaline dial: each trigger adds to it at once (scaled by the
 * bot's gain, capped at 1). Once no threat is present it falls back toward 0 with the given time
 * constant; while a threat is still there it does not fall.
 */
export interface Alarm {
  /** Adds this tick's triggers at time `at` (ms) and returns the new level. */
  update(bump: number, threatPresent: boolean, at: number): number;
  /** The all-clear: what raised it turned out harmless. Alarm drops at once to this share of itself. */
  settle(keep: number): void;
  level(): number;
}

export function createAlarm(settings: { alarmGain: number; alarmDecaySeconds: number }): Alarm {
  let level = 0;
  let last: number | null = null;
  return {
    update(bump, threatPresent, at) {
      const dt = last === null ? 0 : Math.max(0, at - last) / 1000;
      last = at;
      if (!threatPresent) level *= Math.exp(-dt / settings.alarmDecaySeconds);
      level = Math.min(1, level + settings.alarmGain * Math.max(0, bump));
      return level;
    },
    settle(keep) {
      level *= Math.min(1, Math.max(0, keep));
    },
    level: () => level,
  };
}
