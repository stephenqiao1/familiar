import type { Signal } from "@familiar/contracts";
import { ALARM_SIGNAL, DOPAMINE_SIGNAL, FOCUS_SIGNAL } from "@familiar/neuromodulators";
import { HUNGER_SIGNAL, UNSTEADY_SIGNAL, WARY_SIGNAL } from "@familiar/region-brainstem";
import type { Drive } from "../locomotion/index.js";

// The command from above: how the brain's dials set how fast and how carefully the bot travels.
// Change what sets speed or caution here. Every number is a first guess to tune in play.

/** How strongly each dial moves the bot's travel, each 0 (not at all) to 1 (fully). */
export interface LocomotionSettings {
  /** Alarm speeds the bot up, and a frightened bot stops tiptoeing. */
  speedFromAlarm: number;
  /** Recent reward (dopamine) speeds it up; a flat mood slows it. */
  speedFromDopamine: number;
  /** Focus makes it more careful. */
  cautionFromFocus: number;
}

export const DEFAULT_LOCOMOTION: LocomotionSettings = { speedFromAlarm: 1, speedFromDopamine: 1, cautionFromFocus: 1 };

const KEYS = ["speedFromAlarm", "speedFromDopamine", "cautionFromFocus"] as const;

/** What is wrong with the settings, or null if they are fine. */
export function locomotionProblem(s: LocomotionSettings): string | null {
  for (const key of KEYS) if (!(s[key] >= 0 && s[key] <= 1)) return `locomotion.${key} must be 0 to 1, got ${s[key]}`;
  return null;
}

/** With nothing pushing them: a brisk walk, a little care. */
export const RESTING_DRIVE: Drive = { speed: 0.4, caution: 0.3 };
/** Above this alarm the bot does not tiptoe. */
const FRIGHTENED = 0.6;
/**
 * How much unsteadiness adds to caution. On a ledge or a one-wide bridge (unsteady 0.5) this
 * alone lifts caution past the point where the bot goes carefully, whatever its focus.
 */
const CAUTION_FROM_UNSTEADY = 0.7;
/** How much being wary (danger possible, or a threat only being watched) adds to caution: a little. */
const CAUTION_FROM_WARY = 0.15;
const clamp = (n: number) => Math.min(1, Math.max(0, n));

/**
 * The drive for this tick:
 *   speed   = 0.4 + 0.5 × alarm + 0.3 × (dopamine − 0.5) − 0.3 × hunger
 *   caution = 0.3 + 0.3 × focus + 0.15 × wary (0 while alarm is above 0.6), plus 0.7 × unsteady whatever the alarm
 * each kept within 0 to 1. A missing signal counts as its resting value (`resting`). Each
 * strength scales its own term; hunger only slows the bot while some speed link is on, so with
 * every strength at 0 the drive is the fixed resting one (speed 0.4, caution 0.3).
 */
export function driveFrom(signals: Readonly<Record<string, Signal>>, settings: LocomotionSettings, resting: { dopamine: number; focus: number } = { dopamine: 0.5, focus: 0.5 }): Drive {
  const level = (name: string, otherwise: number) => signals[name]?.value ?? otherwise;
  const alarm = level(ALARM_SIGNAL, 0);
  const anySpeedLink = Math.max(settings.speedFromAlarm, settings.speedFromDopamine);
  const speed =
    RESTING_DRIVE.speed +
    settings.speedFromAlarm * 0.5 * alarm +
    settings.speedFromDopamine * 0.3 * (level(DOPAMINE_SIGNAL, resting.dopamine) - 0.5) -
    anySpeedLink * 0.3 * level(HUNGER_SIGNAL, 0);
  const frightened = settings.speedFromAlarm > 0 && alarm > FRIGHTENED;
  // Change how unsteadiness affects caution here. (The signal is already scaled by the bot's posture.unsteady.)
  const caution = (frightened ? 0 : RESTING_DRIVE.caution + settings.cautionFromFocus * 0.3 * level(FOCUS_SIGNAL, resting.focus) + CAUTION_FROM_WARY * level(WARY_SIGNAL, 0)) + CAUTION_FROM_UNSTEADY * level(UNSTEADY_SIGNAL, 0);
  return { speed: clamp(speed), caution: clamp(caution) };
}
