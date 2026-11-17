import type { State } from "@familiar/contracts";
import type { PostureNotes } from "../posture/runtime.js";
import { INNATE_LOOSE } from "../posture/surfaces.js";
import { minecraftDataOf } from "./read-state.js";

// The player's posture settings: its sense of balance and the adjustments that keep it steady.

/** One bot's posture. The list is what it is born knowing; each strength is 0 (off) to 1 (full). */
export interface PostureSettings {
  /** The blocks the bot is born knowing fall when nothing holds them up. Anything else it has to learn by digging under it. */
  innateLoose: string[];
  /** Check before acting: refuse a dig, placement, step or jump that would leave the bot unsteady or hurt. On (1) or off (0, for experiments). */
  check: number;
  /** Hold sneak near an edge or something that hurts while the hands are busy. */
  stance: number;
  /** Share the `unsteady` signal (scales it), which raises locomotion's caution. */
  unsteady: number;
  /** The righting reflex: steer for a better landing while falling. */
  righting: number;
  /** React to being moved somewhere else: stop the journey, forget the old place's marks, plan again. */
  displaced: number;
  /** Learn which surfaces are loose, slippery or slow. */
  learnSurfaces: number;
}

export const DEFAULT_POSTURE: PostureSettings = { innateLoose: INNATE_LOOSE, check: 1, stance: 1, unsteady: 1, righting: 1, displaced: 1, learnSurfaces: 1 };

const STRENGTHS = ["stance", "unsteady", "righting", "displaced", "learnSurfaces"] as const;

/** What is wrong with the settings, or null if they are fine. */
export function postureProblem(s: PostureSettings): string | null {
  if (!Array.isArray(s.innateLoose) || s.innateLoose.some((name) => typeof name !== "string")) return "posture.innateLoose must be a list of block names";
  if (s.check !== 0 && s.check !== 1) return `posture.check must be 0 or 1 (0 is for experiments), got ${s.check}`;
  for (const key of STRENGTHS) if (!(s[key] >= 0 && s[key] <= 1)) return `posture.${key} must be 0 to 1, got ${s[key]}`;
  return null;
}

/**
 * How unsteady the body is right now, 0 to 1 (1 − balance, scaled by the bot's strength).
 *
 * HOOK(focus-unsteady): only locomotion's caution reads the `unsteady` signal so far. The focus
 * dial could read it too (a body on a ledge has reason to pay attention); that is not wired.
 */
export function unsteadyOf(state: State, strength: number): number {
  const self = minecraftDataOf(state)?.self;
  return self ? Math.min(1, Math.max(0, (1 - self.balance) * strength)) : 0;
}

/** What the tick's trace says of posture: what holds the bot up, its balance, a fall under way, and what the posture system did. */
export function postureTrace(state: State, notes: PostureNotes): Record<string, unknown> | null {
  const self = minecraftDataOf(state)?.self;
  if (!self) return null;
  return { support: self.support, balance: self.balance, ...(self.landing ? { landing: self.landing } : {}), ...(self.displaced ? { displaced: true } : {}), ...notes };
}

/** The bot's position has just jumped without it travelling there. */
export function wasDisplaced(state: State): boolean {
  return minecraftDataOf(state)?.self.displaced ?? false;
}
