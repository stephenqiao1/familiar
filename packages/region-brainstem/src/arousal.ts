// How awake the body is: one dial from deep sleep to over-aroused, pushed up by a wake drive
// and down by a sleep drive. Pure and game-free: plain numbers in, plain numbers out.
// Change what wakes or settles the bot here. Every number is a first guess.

export type Band = "asleep" | "drowsy" | "awake" | "alert" | "over-aroused";

/** Where each band begins. */
export const BANDS = { drowsy: 0.15, awake: 0.35, alert: 0.7, overAroused: 0.9 };
/** Arousal rises with this time constant (about there in a second) and falls with this one (about 20 seconds). */
export const TAU_SECONDS = { up: 0.35, down: 7, groggy: 3.3 };
/** What the smaller pushes add to the wake drive. */
const ADDS = { novel: 0.15, demanding: 0.15 };
/** How far each drive moves the target from the resting level. */
const PULL = { wake: 0.5, sleep: 0.45 };
/** Night raises sleepiness by this much; day lowers it by this much. */
const SLEEPY = { night: 0.35, day: 0.2 };
/** Sleep is this deep for the first third of the night, easing to this by morning. */
export const DEPTH = { deep: 0.9, light: 0.4, deepUntil: 1 / 3 };
/** An event wakes a sleeper when its strength is above depth × this (at the usual wake threshold of 0.5). */
export const WAKE_FACTOR = 0.6;
/** Arousal just after a calm waking. */
export const GROGGY = 0.25;
/** A wake drive above this is urgent: it opens the gate fully and gets a bot out of its way to bed. */
export const URGENT = 0.5;
/** The gate's rate when drowsy (arousal 0.35). */
const DROWSY_RATE = 0.3;

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/** What pushes toward waking, each 0 to 1. */
export interface WakeInputs {
  alarm: number;
  threat: number;
  startle: number;
  pain: number;
  urge: number;
  /** Something has just drawn the attention. */
  novel?: boolean;
  /** A demanding skill is under way. */
  demanding?: boolean;
}

/** The wake drive: the largest of the pressing things, plus a little for novelty and for demanding work. Says what set it. */
export function wakeDrive(inputs: WakeInputs): { value: number; by: string } {
  const pressing = (["alarm", "threat", "startle", "pain", "urge"] as const).map((name) => ({ name, value: inputs[name] })).sort((a, b) => b.value - a.value)[0]!;
  const extra = (inputs.novel ? ADDS.novel : 0) + (inputs.demanding ? ADDS.demanding : 0);
  const by = pressing.value > 0 ? pressing.name : inputs.novel ? "novelty" : inputs.demanding ? "a demanding skill" : "nothing";
  return { value: clamp(pressing.value + extra), by };
}

/**
 * Sleep pressure: tiredness, raised at night and lowered by day; none while danger is coming.
 * `night` may be how far night has come (0 day to 1 night, from the body clock), so that
 * sleepiness comes on over dusk and lifts over dawn rather than at a stroke.
 */
export function sleepyOf(tired: number, night: boolean | number, threatened: boolean, strength = 1): number {
  if (threatened) return 0;
  const nightness = clamp(Number(night));
  return clamp(strength * (tired + nightness * SLEEPY.night - (1 - nightness) * SLEEPY.day));
}

/** How restful the moment is, 0 to 1: each of night, safe, nothing to do and recovering counts a quarter. */
export function restful(moment: { night: boolean; safe: boolean; idle: boolean; recovering: boolean }): number {
  return (Number(moment.night) + Number(moment.safe) + Number(moment.idle) + Number(moment.recovering)) / 4 + (moment.safe && moment.idle ? 0.25 : 0);
}

/** The sleep drive: sleep pressure × how restful the moment is. */
export function sleepDrive(sleepy: number, rest: number): number {
  return clamp(sleepy * Math.min(1, rest));
}

/** Where arousal is heading while awake: resting + 0.5 × wake − 0.45 × sleep, kept within 0 to 1. */
export function targetOf(wake: number, sleep: number, resting = 0.5): number {
  return clamp(resting + PULL.wake * wake - PULL.sleep * sleep);
}

/** Where arousal sits while asleep: lower the deeper the sleep, always inside the asleep band. */
export function asleepLevel(depth: number): number {
  return BANDS.drowsy * 0.8 * (1 - depth);
}

/** One step toward the target: quickly going up, slowly coming down (slowly up too while groggy). */
export function stepArousal(current: number, target: number, seconds: number, groggy = false): number {
  const tau = target > current ? (groggy ? TAU_SECONDS.groggy : TAU_SECONDS.up) : TAU_SECONDS.down;
  return target + (current - target) * Math.exp(-Math.max(0, seconds) / tau);
}

export function bandOf(arousal: number): Band {
  if (arousal < BANDS.drowsy) return "asleep";
  if (arousal < BANDS.awake) return "drowsy";
  if (arousal > BANDS.overAroused) return "over-aroused";
  return arousal > BANDS.alert ? "alert" : "awake";
}

/** How deep sleep is, by how far through the night it is (0 at dusk, 1 at dawn): deep for the first third, easing to light. */
export function depthOf(nightProgress: number): number {
  const p = clamp(nightProgress);
  if (p <= DEPTH.deepUntil) return DEPTH.deep;
  return DEPTH.deep - (DEPTH.deep - DEPTH.light) * ((p - DEPTH.deepUntil) / (1 - DEPTH.deepUntil));
}

/** Whether an event of this strength wakes a sleeper this deep. `threshold` 0.5 is usual; higher is a heavier sleeper. */
export function wakes(strength: number, depth: number, threshold = 0.5): boolean {
  return strength > depth * WAKE_FACTOR * (threshold / 0.5);
}

/**
 * How often the deciding layers may be called, as a share of their usual rate: 0 asleep, about
 * 0.3 drowsy, 1 once properly awake, smooth in between. Anything urgent opens it fully.
 */
export function rateOf(arousal: number, wake: number, asleep: boolean, resting = 0.5): number {
  if (wake > URGENT) return 1;
  if (asleep || arousal <= BANDS.drowsy) return 0;
  if (arousal <= BANDS.awake) return (DROWSY_RATE * (arousal - BANDS.drowsy)) / (BANDS.awake - BANDS.drowsy);
  const full = Math.max(resting - 0.05, BANDS.awake + 0.05);
  return arousal >= full ? 1 : DROWSY_RATE + ((1 - DROWSY_RATE) * (arousal - BANDS.awake)) / (full - BANDS.awake);
}
