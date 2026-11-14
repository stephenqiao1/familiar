// What patience changes. Each effect takes a strength: 0 leaves behaviour exactly as it was
// without patience, 1 applies the effect in full.

/** Patience as an effect of this strength sees it: strength 0 is always the neutral 0.5. */
const felt = (patience: number, strength: number) => 0.5 + (patience - 0.5) * strength;

/**
 * Effect a, persistence: how much longer or shorter to wait before giving up on a skill.
 * (0.5 + patience) × (0.5 + chanceOfPayoff): waiting longest takes both patience and a good
 * chance the skill pays off. Neutral patience with an unknown chance (0.5) gives 1.
 */
export function giveUpFactor(patience: number, chanceOfPayoff: number, strength: number): number {
  return 1 + strength * ((0.5 + patience) * (0.5 + chanceOfPayoff) - 1);
}

/**
 * Effect c, the brake: what to multiply a risky skill's score by. 1.2 − 0.6 × patience: low
 * patience makes the bot more reactive, high patience makes it hold back.
 */
export function brakeFactor(patience: number, strength: number): number {
  return 1 + strength * (1.2 - 0.6 * patience - 1);
}

/** What the planner is told, and how many steps it may queue. Empty means no change. */
export interface PlanningHorizon {
  instruction?: string;
  maxSteps?: number;
}

const LOW = 0.35;
const HIGH = 0.65;

/** Effect b, the planning horizon: a plain instruction for the planner, and 2 (low) to 5 (high) steps. */
export function planningHorizon(patience: number, strength: number): PlanningHorizon {
  if (strength <= 0) return {};
  const p = felt(patience, strength);
  const maxSteps = Math.round(2 + 3 * Math.min(1, Math.max(0, p)));
  if (p < LOW) return { instruction: "Focus on immediate needs. Pick goals that pay off within a minute or two.", maxSteps };
  if (p > HIGH) return { instruction: "You can afford longer projects: building, farming, stocking up, exploring further.", maxSteps };
  return { maxSteps };
}
