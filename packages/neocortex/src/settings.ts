// The bot's own settings for the cortex: the strength of each part, 0 to 1. With all of them at 0
// the cortex is two areas (instinct and the prefrontal cortex) that only pass the goal down.

export interface CortexSettings {
  /** The motor area: how much of the goal's priority its proposals carry (0: it carries out no step). */
  motor: number;
  /** Above 0: a step's "done when" and "give up when" are checked by code, and the planner is shown the vocabulary. */
  conditions: number;
  /** How far a hold-back's own strength and end are honoured (0: every hold-back is in full, for as long as the goal). */
  holdBack: number;
  /** The goal channel: how far a goal must match the standing one's priority to replace it, and whether a protected goal is kept (0: every goal offered replaces the last). */
  goalGate: number;
  /** The sensory area: how much of each surprise is shared as `unexpected` (0: it reports nothing, and nothing reads it). */
  sensory: number;
  /** Above 0: the planner keeps notes between plans (0: it keeps none and is shown none). */
  notes: number;
  /** Above 0: a chain of abilities that has finished the same kind of step three times is saved as a skill of its own (0: nothing is noted or saved). */
  chunks: number;
}

export const DEFAULT_CORTEX: CortexSettings = { motor: 1, conditions: 1, holdBack: 1, goalGate: 1, sensory: 1, notes: 1, chunks: 1 };
/** Every part off: the cortex as it was with two areas. */
export const NO_CORTEX: CortexSettings = { motor: 0, conditions: 0, holdBack: 0, goalGate: 0, sensory: 0, notes: 0, chunks: 0 };

/** What is wrong with the settings, or null. */
export function cortexProblem(settings: CortexSettings): string | null {
  for (const key of Object.keys(DEFAULT_CORTEX) as (keyof CortexSettings)[]) {
    const value = settings[key];
    if (typeof value !== "number" || !(value >= 0 && value <= 1)) return `cortex.${key} must be a number from 0 to 1, got ${JSON.stringify(value)}`;
  }
  return null;
}
