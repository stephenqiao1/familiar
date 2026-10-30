import type { Answer } from "./answer.js";
import type { Question } from "./question.js";
import type { State } from "./state.js";

/** Anything that turns a state and questions into answers. */
export interface DecisionEngine {
  name: string;
  decide(state: State, questions: Question[]): Promise<Answer[]>;
  /** The engine's own timing of its most recent decide call, if it measures one. */
  lastTiming?(): { totalMs: number } | null;
}
