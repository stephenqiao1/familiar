import { FOCUS_MAX, FOCUS_MIN, type FocusSettings } from "./settings.js";

/** The workspace signal that carries focus. */
export const FOCUS_SIGNAL = "focus";
/** 1 on the tick a cue fired: something the bot was looking for came into view. */
export const CUE_SIGNAL = "cue";
/** How far one input at full strength moves the level focus heads for. */
const INPUT_WEIGHT = 0.5;
/** The level at which consolidation may run, and below which only important events are recorded. */
export const LOW_FOCUS = 0.2;

/**
 * Focus (0.05 to 0.95), modelled on acetylcholine: "trust your senses and learn this now", as
 * against "assume what you already know". It heads for the resting level plus its inputs (what
 * the bot knows not holding up, or there being little of it, push it up; predictions holding in
 * a place it knows pull it down) with the given time constant. Asleep, it is forced to 0.05.
 */
export interface Focus {
  /** Feeds the inputs' sum at time `at` (ms); returns the new level. */
  update(pressure: number, asleep: boolean, at: number): number;
  level(): number;
}

export function createFocus(settings: Pick<FocusSettings, "resting" | "timeConstantSeconds">): Focus {
  let level = settings.resting;
  let last: number | null = null;
  return {
    update(pressure, asleep, at) {
      const dt = last === null ? 0 : Math.max(0, at - last) / 1000;
      last = at;
      if (asleep) return (level = FOCUS_MIN);
      const target = Math.min(1, Math.max(0, settings.resting + INPUT_WEIGHT * pressure));
      level = Math.min(FOCUS_MAX, Math.max(FOCUS_MIN, level + (target - level) * Math.min(1, dt / settings.timeConstantSeconds)));
      return level;
    },
    level: () => level,
  };
}

/** Effect a: trust in something remembered `ageMs` ago; it halves every half-life. */
export function trustOf(ageMs: number, halfLifeMs: number): number {
  return 0.5 ** (Math.max(0, ageMs) / halfLifeMs);
}
