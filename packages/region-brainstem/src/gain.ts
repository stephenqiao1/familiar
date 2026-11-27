import type { Goal, HoldBack, Proposal, Workspace } from "@familiar/contracts";
import type { BrainstemSettings } from "./settings.js";

/** A soft reflex's gain never leaves this range, whatever alarm, bravery and the goal say. */
export const MIN_GAIN = 0.3;
export const MAX_GAIN = 1.5;
/** A held-back reflex fires at this fraction of its gain. */
export const HELD_BACK = 0.3;
/** How far bravery moves a gain: at full bravery fleeing is this much weaker and fighting this much stronger. */
const BRAVERY_SWING = 0.4;

/** Which way a reflex's skill takes the bot: away from the threat, toward it, or neither. */
export type Leaning = "away" | "toward" | null;

export interface GainInputs {
  /** Alarm, 0 to 1. */
  alarm: number;
  /** The bot's bravery, 0 to 1. */
  bravery: number;
  leaning: Leaning;
  /** How strongly the current goal holds this reflex back: 0 (not at all) to 1 (in full). true and false read as 1 and 0. */
  heldBack: number | boolean;
}

/**
 * How strongly a soft reflex fires: gain = (0.6 + 0.8 × alarm) × bravery factor × hold-back factor,
 * kept within 0.3 to 1.5. Calm, reflexes are damped; alarmed, they are boosted. A brave bot flees
 * less readily and fights more readily; a timid one the reverse. A reflex the goal holds back in
 * full fires at 0.3 of its gain, and one held back in part at somewhere between. `strengths` (0 to 1 each) scale the two effects: 0 leaves the gain at 1.
 */
export function reflexGain({ alarm, bravery, leaning, heldBack }: GainInputs, strengths: { gains: number; holdBack: number } = { gains: 1, holdBack: 1 }): number {
  const lean = leaning === "away" ? -1 : leaning === "toward" ? 1 : 0;
  const braveryFactor = 1 + lean * (bravery - 0.5) * 2 * BRAVERY_SWING;
  const tuned = 1 + strengths.gains * ((0.6 + 0.8 * alarm) * braveryFactor - 1);
  const holdBackFactor = 1 - strengths.holdBack * Math.min(1, Math.max(0, Number(heldBack))) * (1 - HELD_BACK);
  return Math.min(MAX_GAIN, Math.max(MIN_GAIN, tuned * holdBackFactor));
}

/** Whether a hold-back has ended: its step is finished, or its seconds are up. One with no end lasts as long as the goal. */
export function lapsed(held: HoldBack, goal: Pick<Goal, "stepsDone">, now: number): boolean {
  if (held.until === "step") return goal.stepsDone > (held.step ?? 0);
  return typeof held.until === "number" && now - (held.since ?? now) >= held.until * 1000;
}

/**
 * How strongly the goal holds back a reflex right now, 0 to 1: the strongest hold-back still in
 * force that names the reflex or the skill it proposes. `graded` (0 to 1) says how far a
 * hold-back's own strength and end count: at 0 every one is in full for as long as the goal.
 */
export function heldBack(goal: Pick<Goal, "holdBack" | "stepsDone"> | null, rule: string, skill: string | null, now = Date.now(), graded = 1): number {
  const held = (goal?.holdBack ?? []).filter((h) => (h.name === rule || h.name === skill) && !(graded > 0 && lapsed(h, goal!, now)));
  return Math.max(0, ...held.map((h) => 1 + graded * (h.strength - 1)));
}

/** Whether the goal holds back a reflex at all right now. */
export const isHeldBack = (goal: Pick<Goal, "holdBack" | "stepsDone"> | null, rule: string, skill: string | null, now = Date.now()): boolean => heldBack(goal, rule, skill, now) > 0;

export interface ReflexGainOptions {
  settings: Pick<BrainstemSettings, "bravery" | "gains" | "holdBack">;
  /** Alarm as last shared (last tick's value is fine). */
  alarmOf(ws: Workspace): number;
  /** Which way a skill takes the bot (flee: away, attack: toward). */
  leaningOf(skill: string): Leaning;
  /**
   * How pressing the danger is this very tick, 0 to 1. Alarm as shared is last tick's, so a
   * threat's first tick would be damped; the gain uses whichever is higher. Default: alarm alone.
   */
  threatOf?(ws: Workspace): number;
  /** How far a hold-back's own strength and end count, 0 to 1. Default: 1 (a plain hold-back is in full and lasts as long as the goal either way). */
  graded?: number;
}

/** The reflex region's `gainOf`: reads alarm and the goal from the workspace each time a soft rule fires. */
export function createReflexGain({ settings, alarmOf, leaningOf, threatOf, graded = 1 }: ReflexGainOptions) {
  return (rule: { name: string }, ws: Workspace, proposal: Proposal): number => {
    const skill = "skill" in proposal.action ? proposal.action.skill : null;
    return reflexGain(
      { alarm: Math.max(alarmOf(ws), threatOf?.(ws) ?? 0), bravery: settings.bravery, leaning: skill === null ? null : leaningOf(skill), heldBack: heldBack(ws.goal, rule.name, skill, Date.now(), graded) },
      settings,
    );
  };
}
