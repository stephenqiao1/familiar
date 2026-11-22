/**
 * Alarm (0 to 1), the fast noradrenaline dial. It follows the evidence:
 *   - it is never below what the vital needs are pressing at right now (`sustained`), so it
 *     rises with the danger and comes down with it;
 *   - a need suddenly getting worse (`jump`, already scaled by the bot's gain) lifts it to that
 *     much at least. Jumps do not pile up, so a need worsening a little every tick is not alarm;
 *   - whatever is left once the cause has gone fades with the given time constant (seconds).
 */
export interface Alarm {
  /** Feeds this tick's sustained level and jump at time `at` (ms); returns the new level. */
  update(sustained: number, jump: number, at: number): number;
  level(): number;
}

export function createAlarm(settings: { alarmDecaySeconds: number }): Alarm {
  let level = 0;
  let last: number | null = null;
  return {
    update(sustained, jump, at) {
      const dt = last === null ? 0 : Math.max(0, at - last) / 1000;
      last = at;
      level = Math.min(1, Math.max(sustained, level * Math.exp(-dt / settings.alarmDecaySeconds), jump, 0));
      return level;
    },
    level: () => level,
  };
}
