import type { Goal, Proposal, Workspace } from "@familiar/contracts";
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
  /** The current goal asked for this reflex to be held back. */
  heldBack: boolean;
}

/**
 * How strongly a soft reflex fires: gain = (0.6 + 0.8 × alarm) × bravery factor × hold-back factor,
 * kept within 0.3 to 1.5. Calm, reflexes are damped; alarmed, they are boosted. A brave bot flees
 * less readily and fights more readily; a timid one the reverse. A reflex the goal holds back
 * fires at 0.3 of its gain. `strengths` (0 to 1 each) scale the two effects: 0 leaves the gain at 1.
 */
export function reflexGain({ alarm, bravery, leaning, heldBack }: GainInputs, strengths: { gains: number; holdBack: number } = { gains: 1, holdBack: 1 }): number {
  const lean = leaning === "away" ? -1 : leaning === "toward" ? 1 : 0;
  const braveryFactor = 1 + lean * (bravery - 0.5) * 2 * BRAVERY_SWING;
  const tuned = 1 + strengths.gains * ((0.6 + 0.8 * alarm) * braveryFactor - 1);
  const holdBackFactor = heldBack ? 1 - strengths.holdBack * (1 - HELD_BACK) : 1;
  return Math.min(MAX_GAIN, Math.max(MIN_GAIN, tuned * holdBackFactor));
}

/** Whether the goal holds back a reflex: it names the reflex, or the skill the reflex proposes. */
export function isHeldBack(goal: Pick<Goal, "holdBack"> | null, rule: string, skill: string | null): boolean {
  const names = goal?.holdBack ?? [];
  return names.includes(rule) || (skill !== null && names.includes(skill));
}

export interface ReflexGainOptions {
  settings: Pick<BrainstemSettings, "bravery" | "gains" | "holdBack">;
  /** Alarm as last shared (last tick's value is fine). */
  alarmOf(ws: Workspace): number;
  /** Which way a skill takes the bot (flee: away, attack: toward). */
  leaningOf(skill: string): Leaning;
}

/** The reflex region's `gainOf`: reads alarm and the goal from the workspace each time a soft rule fires. */
export function createReflexGain({ settings, alarmOf, leaningOf }: ReflexGainOptions) {
  return (rule: { name: string }, ws: Workspace, proposal: Proposal): number => {
    const skill = "skill" in proposal.action ? proposal.action.skill : null;
    return reflexGain(
      { alarm: alarmOf(ws), bravery: settings.bravery, leaning: skill === null ? null : leaningOf(skill), heldBack: isHeldBack(ws.goal, rule.name, skill) },
      settings,
    );
  };
}
