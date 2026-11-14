import { DA_FLOOR, RESTING_DA } from "./tonic.js";

/** One bot's dopamine temperament. */
export interface DopaminePersonality {
  /** Where DA rests with no recent reward: higher is eager, lower is cautious. */
  restingDA: number;
  /** How far each surprise moves the scorebook: higher changes its mind quickly, lower is stubborn. */
  learningRate: number;
  /** Reward for meeting a new kind of thing: higher is an explorer, lower a creature of habit. */
  noveltyBonus: number;
}

export const DEFAULT_PERSONALITY: DopaminePersonality = { restingDA: RESTING_DA, learningRate: 0.1, noveltyBonus: 0.5 };

/** What is wrong with a personality, or null if it is fine. */
export function personalityProblem(p: DopaminePersonality): string | null {
  if (!(p.restingDA > DA_FLOOR && p.restingDA < 1)) return `restingDA must be above ${DA_FLOOR} and below 1, got ${p.restingDA}`;
  if (!(p.learningRate > 0 && p.learningRate <= 1)) return `learningRate must be above 0 and at most 1, got ${p.learningRate}`;
  if (!(p.noveltyBonus >= 0)) return `noveltyBonus must be 0 or more, got ${p.noveltyBonus}`;
  return null;
}
