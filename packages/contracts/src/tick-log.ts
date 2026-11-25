import type { Action } from "./action.js";
import type { Attended, Candidate, Goal, Proposal, Signal } from "./brain.js";
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
  /** A proposal acted on alongside the main action, using other body parts. */
  alongside?: Candidate;
  /** What the arbiter weighed: every candidate, each term that moved its score, and who won. */
  selection?: Record<string, unknown>;
  goal: Goal | null;
  signals: Record<string, Signal>;
  /** What the agent was attending to at the end of the tick, if anything. */
  attended?: Attended | null;
  /** Skill lifecycle events since the previous tick. */
  skillEvents?: SkillEvent[];
  /** Hostile mobs seen for the first time in this tick's state. */
  firstSeen?: FirstSeen[];
  /** Set on the tick the agent died soon after a tunable defence reflex was held back or outvoted. */
  defenceOverruledBeforeDeath?: unknown;
  /** On the tick after a death: the defence chosen on each tick of the 5 seconds before it, with the threat it was chosen for. */
  defenceBeforeDeath?: unknown;
}
