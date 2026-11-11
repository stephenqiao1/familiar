import type { Action } from "./action.js";
import type { RunningSkill } from "./skill.js";
import type { SkillEvent } from "./skill-event.js";
import type { State } from "./state.js";

// The brain is a set of regions that share one Workspace and never call each other.
// Each tick, regions read the workspace and return Proposals; the Arbiter picks one to act on.

/** One region's suggestion: do `action`, and how urgent it is. */
export interface Proposal {
  action: Action;
  /** From 0 (whenever) to 1 (right now). The Arbiter picks the highest. */
  urgency: number;
  /** Plain words, for logs and research. */
  reason: string;
}

/** A goal written by a planning region. Other regions read it to guide their choices. */
export interface Goal {
  text: string;
  steps: string[];
  reason: string;
  /** The region that set it. */
  setBy: string;
  setAt: number;
}

/** A named level (fear, hunger, ...) one region shares with the others. From 0 to 1. */
export interface Signal {
  value: number;
  source: string;
  at: number;
}

/** The brain's shared memory: the only way regions communicate. */
export interface Workspace {
  /** The latest world state. */
  readonly state: State;
  /** The skill running right now, if any. */
  readonly current: RunningSkill | null;
  readonly goal: Goal | null;
  readonly signals: Readonly<Record<string, Signal>>;
  /** Skill lifecycle events, oldest first, at most the last 20. */
  readonly recentEvents: readonly SkillEvent[];
  /** Replaces the goal. `setBy` and `setAt` are filled in for you. */
  setGoal(goal: Pick<Goal, "text" | "steps" | "reason">): void;
  setSignal(name: string, value: number): void;
}

/** What a region returns each time it runs. */
export interface RegionOutput {
  proposals: Proposal[];
  /** Anything worth keeping in the log for research (questions, answers, prompts, rules fired). */
  trace?: Record<string, unknown>;
}

/** One part of the brain. Add a region by writing one of these and listing it in the brain. */
export interface Region {
  /** Unique, e.g. "reflex". Used in logs and the --regions flag. */
  name: string;
  /** Speed rank: lower is faster and wins urgency ties. Reflex 0, instinct 1, neocortex 2. */
  layer: number;
  /**
   * 0: runs inside every tick, and the tick waits for it.
   * Above 0: runs in the background at most this often; the tick never waits for it, and its
   * latest proposals stay in play until it runs again.
   */
  everyMs: number;
  /** Give up after this long (the run counts as failed). Default: no limit. */
  timeoutMs?: number;
  /** Must stop promptly when `signal` aborts. */
  run(ws: Workspace, signal: AbortSignal): RegionOutput | Promise<RegionOutput>;
}

/** A proposal with the region it came from. */
export interface Candidate extends Proposal {
  region: string;
  layer: number;
}

/** Picks the one proposal to act on (the brain's basal ganglia). */
export interface Arbiter {
  name: string;
  pick(candidates: Candidate[]): Candidate | null;
  /**
   * Optional shortcut for fast reactions: given the candidates so far and the layers of regions
   * still running, return the winner if nothing still running could change it; else null.
   */
  settledEarly?(candidates: Candidate[], pendingLayers: number[]): Candidate | null;
}
