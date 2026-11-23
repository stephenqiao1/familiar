import type { Weighs } from "./need.js";

/**
 * One bot's drives (the "drives" block of bots.json). Each strength is 0 (off: the bot behaves
 * as if the part did not exist) to 1 (full). Every hand-set number of the hypothalamus is here
 * or in the named tables beside the code that uses it.
 */
export interface DriveSettings {
  /** The body's own readings (cold, tired, sick) count as needs. */
  body: number;
  /** A need that is rising presses before it arrives. */
  lookAhead: number;
  /** How much is enough moves with the moment. */
  targets: number;
  /** How much is enough is raised by running out, and drifts back. */
  learnTargets: number;
  /** The time of day tunes what presses. */
  clock: number;
  /** Slow stress builds under strain and fades over minutes. */
  stress: number;
  /** A need of the body that is nearly at its worst loosens caution. */
  desperate: number;
  /** A need that goes unmet for minutes raises search. */
  unmet: number;
  /** The planner is told what the body wants most, and asked again when that changes. */
  tellPlanner: number;
  /** How much each class of need darkens the outlook when unmet. */
  weights: Record<Weighs, number>;
  /** The weight of one need by name, over its class's. */
  weight?: Record<string, number>;
}

export const DEFAULT_DRIVES: DriveSettings = { body: 1, lookAhead: 1, targets: 1, learnTargets: 1, clock: 1, stress: 1, desperate: 1, unmet: 1, tellPlanner: 1, weights: { danger: 2, body: 1, provision: 0.25 } };

/** Every part off: the needs are read as they stand, and nothing else is added. */
export const DRIVES_OFF: DriveSettings = { ...DEFAULT_DRIVES, body: 0, lookAhead: 0, targets: 0, learnTargets: 0, clock: 0, stress: 0, desperate: 0, unmet: 0, tellPlanner: 0 };

const STRENGTHS = ["body", "lookAhead", "targets", "learnTargets", "clock", "stress", "desperate", "unmet", "tellPlanner"] as const;
/** A weight above this would let one need drown out every other. */
const MAX_WEIGHT = 5;

/** What is wrong with the settings, or null if they are fine. */
export function drivesProblem(s: DriveSettings): string | null {
  for (const key of STRENGTHS) if (!(s[key] >= 0 && s[key] <= 1)) return `drives.${key} must be 0 to 1, got ${s[key]}`;
  const weights = [...Object.entries(s.weights ?? {}).map(([k, v]) => [`weights.${k}`, v] as const), ...Object.entries(s.weight ?? {}).map(([k, v]) => [`weight.${k}`, v] as const)];
  for (const [key, value] of weights) if (!(value >= 0 && value <= MAX_WEIGHT)) return `drives.${key} must be 0 to ${MAX_WEIGHT}, got ${value}`;
  for (const key of ["danger", "body", "provision"] as const) if (typeof s.weights?.[key] !== "number") return `drives.weights.${key} is missing`;
  return null;
}

/** The weight a need takes from the settings. */
export function weightOf(need: { name: string; weighs?: Weighs }, settings: Pick<DriveSettings, "weights" | "weight"> = DEFAULT_DRIVES): number {
  return settings.weight?.[need.name] ?? settings.weights[need.weighs ?? "body"];
}
