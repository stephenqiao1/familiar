import type { Action } from "./action.js";
import type { Answer } from "./answer.js";
import type { Question } from "./question.js";
import type { State } from "./state.js";

/** One record per tick. */
export interface TickLog {
  tick: number;
  timestamp: number;
  state: State;
  questions: Question[];
  answers: Answer[];
  engineLatencyMs: number;
  action: Action;
}
