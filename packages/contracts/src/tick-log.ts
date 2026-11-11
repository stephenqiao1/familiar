import type { Action } from "./action.js";
import type { Candidate, Goal, Proposal, Signal } from "./brain.js";
import type { FirstSeen } from "./first-seen.js";
import type { SkillEvent } from "./skill-event.js";
import type { State } from "./state.js";

/** One region run, as logged. */
export interface RegionLog {
  region: string;
  layer: number;
  /** True for a background region whose run finished since the last tick. */
  background?: boolean;
  ms: number;
  proposals: Proposal[];
  trace?: Record<string, unknown>;
  error?: string;
}

/** One record per tick. */
export interface TickLog {
  tick: number;
  timestamp: number;
  state: State;
  /** Time to build the state (encode), in ms. */
  encodeMs: number;
  /** Time from the start of the tick until the action was chosen, in ms. */
  decideMs: number;
  regions: RegionLog[];
  winner: Candidate | null;
  action: Action;
  goal: Goal | null;
  signals: Record<string, Signal>;
  /** Skill lifecycle events since the previous tick. */
  skillEvents?: SkillEvent[];
  /** Hostile mobs seen for the first time in this tick's state. */
  firstSeen?: FirstSeen[];
}
