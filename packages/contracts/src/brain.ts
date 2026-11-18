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

/** An item a goal needs the agent to carry, and how many. */
export interface ItemWant {
  item: string;
  count: number;
}

/** A response loaded in advance: when a thing of kind `when` appears, do `skill` without waiting to be told. */
export interface IfThen {
  /** A kind of thing, in the same words as `watchFor` (e.g. "creeper", "chest"). */
  when: string;
  /** The name of an existing skill. */
  skill: string;
  /** A prepared action: a full startle releases it at once, whatever caused the startle. Default: false. */
  onStartle?: boolean;
}

/** A goal written by a planning region. Other regions read it to guide their choices. */
export interface Goal {
  text: string;
  steps: string[];
  reason: string;
  /** What to carry for this goal: taking from storage fetches these, storing keeps them. */
  wants: ItemWant[];
  /** Kinds of things to watch for (e.g. "chest", "villager"): spotting one is a cue to act. */
  watchFor: string[];
  /** Responses loaded in advance (at most 3), fired by the fastest layer the moment their thing appears. */
  ifThen: IfThen[];
  /** Soft reflexes to hold back while this goal is active, by reflex name or by the skill they propose. */
  holdBack: string[];
  /** How many of `steps` the planner has judged finished. */
  stepsDone: number;
  /** When a step (of this goal or an earlier one) was last judged finished, or null if never. */
  stepDoneAt: number | null;
  /** The region that set it. */
  setBy: string;
  setAt: number;
}

/**
 * A named level (fear, hunger, ...) one region shares with the others. From 0 to 1.
 * TODO(mood): allow a per-signal range, so levels like mood (-1 to 1) can be shared too.
 */
export interface Signal {
  value: number;
  source: string;
  at: number;
}

/** The one thing the agent is attending to right now. */
export interface Attended {
  /** A target string for the thing (or the place a sound came from). */
  id: string;
  /** What kind of thing, as far as anything has said ("zombie", "explosion", "unknown"). */
  kind: string;
  /** Which way it lies from where the head faces: "ahead", "left", "right" or "behind". */
  bearing: string;
  /** How striking it was when it won attention. */
  salience: number;
  /** When it won attention. */
  since: number;
}

/** The brain's shared memory: the only way regions communicate. */
export interface Workspace {
  /** The latest world state. */
  readonly state: State;
  /** The skill running right now, if any. */
  readonly current: RunningSkill | null;
  readonly goal: Goal | null;
  readonly signals: Readonly<Record<string, Signal>>;
  /** The one thing being attended to, or null. */
  readonly attended: Attended | null;
  /** Skill lifecycle events, oldest first, at most the last 20. */
  readonly recentEvents: readonly SkillEvent[];
  /** Replaces the goal. `setBy` and `setAt` are filled in for you; the rest default to none. */
  setGoal(goal: Pick<Goal, "text" | "steps" | "reason"> & Partial<Pick<Goal, "wants" | "watchFor" | "ifThen" | "holdBack" | "stepsDone" | "stepDoneAt">>): void;
  /** Drops the goal (e.g. when an alarm cancels the plan). */
  clearGoal(): void;
  setSignal(name: string, value: number): void;
  /** Says what is being attended to (one thing at a time), or null for nothing. */
  setAttended(attended: Attended | null): void;
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
  /** Speed rank: lower is faster and wins urgency ties. Reflex 0, instinct 1, prefrontal 2. */
  layer: number;
  /**
   * 0: runs inside every tick, and the tick waits for it.
   * Above 0: runs in the background at most this often; the tick never waits for it, and its
   * latest proposals stay in play until it runs again.
   */
  everyMs: number;
  /** Give up after this long (the run counts as failed). Default: no limit. */
  timeoutMs?: number;
  /** For a background region: true to run at the next tick without waiting for `everyMs`. */
  dueNow?(ws: Workspace): boolean;
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
  /** `ws` is the workspace after this tick's regions ran (e.g. for signals). */
  pick(candidates: Candidate[], ws: Workspace): Candidate | null;
  /**
   * Optional shortcut for fast reactions: given the candidates so far and the layers of regions
   * still running, return the winner if nothing still running could change it; else null.
   */
  settledEarly?(candidates: Candidate[], pendingLayers: number[], ws: Workspace): Candidate | null;
}
