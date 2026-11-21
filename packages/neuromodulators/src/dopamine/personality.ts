import { DA_FLOOR, RESTING_DA } from "./tonic.js";

/** One bot's dopamine temperament. */
export interface DopaminePersonality {
  /** Where DA rests with no recent reward: higher is eager, lower is cautious. */
  restingDA: number;
  /** How far each surprise moves the scorebook: higher changes its mind quickly, lower is stubborn. */
  learningRate: number;
  /** Reward for meeting a new kind of thing: higher is an explorer, lower a creature of habit. */
  noveltyBonus: number;
  /** How much effort that came to nothing costs: 1 is the usual amount, 0 never counts it. */
  wastedEffort: number;
  /** How far a skill is judged on the difference it made to the situation, not on what it started in: 1 fully, 0 not at all. */
  situationWorth: number;
  /** How strongly a wanted thing in view pulls: 1 is the usual amount, 0 never (it still learns). */
  wanting: number;
}

export const DEFAULT_PERSONALITY: DopaminePersonality = { restingDA: RESTING_DA, learningRate: 0.1, noveltyBonus: 0.5, wastedEffort: 1, situationWorth: 1, wanting: 1 };

/** What is wrong with a personality, or null if it is fine. */
export function personalityProblem(p: DopaminePersonality): string | null {
  if (!(p.restingDA > DA_FLOOR && p.restingDA < 1)) return `restingDA must be above ${DA_FLOOR} and below 1, got ${p.restingDA}`;
  if (!(p.learningRate > 0 && p.learningRate <= 1)) return `learningRate must be above 0 and at most 1, got ${p.learningRate}`;
  if (!(p.noveltyBonus >= 0)) return `noveltyBonus must be 0 or more, got ${p.noveltyBonus}`;
  if (!(p.wastedEffort >= 0)) return `wastedEffort must be 0 or more, got ${p.wastedEffort}`;
  if (!(p.situationWorth >= 0 && p.situationWorth <= 1)) return `situationWorth must be from 0 to 1, got ${p.situationWorth}`;
  if (!(p.wanting >= 0)) return `wanting must be 0 or more, got ${p.wanting}`;
  return null;
}
