import type { Action } from "./action.js";
import type { Answer } from "./answer.js";
import type { FirstSeen } from "./first-seen.js";
import type { Question } from "./question.js";
import type { SkillEvent } from "./skill-event.js";
import type { State } from "./state.js";

/** One record per tick. */
export interface TickLog {
  tick: number;
  timestamp: number;
  state: State;
  questions: Question[];
  answers: Answer[];
  /** Time to build the state (encode), in ms. Missing in logs from before M2 Part 6. */
  encodeMs?: number;
  engineLatencyMs: number;
  action: Action;
  /** Skill lifecycle events since the previous tick. */
  skillEvents?: SkillEvent[];
  /** Hostile mobs seen for the first time in this tick's state. */
  firstSeen?: FirstSeen[];
}
