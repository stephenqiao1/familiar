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
  /** Degrees from straight ahead (left is positive) and above eye level, when it won. Left out if not known. */
  angle?: number;
  elevation?: number;
  /** The part of the view it is in: "upper" (well above eye level), "lower" (well below) or "level". */
  field?: "upper" | "lower" | "level";
  /** What its place and movement lean the body toward, from physical facts alone: advice, not a decision. Left out for none. */
  lean?: "avoid" | "freeze" | "approach";
}

/** One need as the hypothalamus read it this tick. */
export interface NeedReading {
  name: string;
  /** What the need is about ("hunger", "safety", "having_enough"). */
  kind: string;
  /** How pressing it is by the body's own reading: 0 = met, 1 = desperate. */
  level: number;
  /** How vital it is next to the others (higher = more vital). */
  rank: number;
  /** How much it darkens the outlook when unmet (1 = in full). */
  weight: number;
  /**
   * How hard it presses for action right now: its level, raised by where it is heading and
   * tuned by the time of day and by stress, or 0 while a more vital need presses at all.
   */
  pressing: number;
  /** How hard it would press with nothing more vital pressing (the same as `pressing` unless it is silenced). Left out by a plain reading. */
  tuned?: number;
  /** Where the level is heading: what it would be in a minute at the rate of the last one. Left out when nothing looks ahead. */
  projected?: number;
  /** How much is enough right now, for a need about having some of a thing. */
  target?: number;
}

/** The need the body wants most right now. It is sticky: a rival must clearly beat it to take its place. */
export interface TopDrive {
  name: string;
  kind: string;
  /** How hard it presses, by its weight (0 to 1). */
  score: number;
  /** When it took the top place (ms). */
  since: number;
}

/** The body's clock: where in the day it is. */
export interface BodyClock {
  /** How far through the whole day, 0 (sunrise) to 1. */
  phase: number;
  night: boolean;
  /** How far through the night, 0 to 1 (0 by day). */
  nightProgress: number;
  /** Rises from 0 to 1 over the last three minutes of the day. */
  dusk: number;
  /** Rises from 0 to 1 over the last three minutes of the night. */
  dawn: number;
}

/** The body's needs this tick, read once by the hypothalamus for every other region to use. */
export interface Needs {
  readings: NeedReading[];
  /** Needs that live inside one region (boredom, in dopamine's own memory): tuned like the rest, but not part of how things stand. */
  inner?: NeedReading[];
  /** The need the body wants most, or null with nothing pressing. */
  top?: TopDrive | null;
  /** The time of day, when the body clock is on. */
  clock?: BodyClock;
  /** Slow stress, 0 to 1. */
  stress?: number;
  /** The need that is desperate (a need of the body above 0.8), or null. */
  desperate?: string | null;
  /** Whether nothing the bot has learned relieves the need it wants most. */
  unmet?: boolean;
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
  /** The body's needs as the hypothalamus read them this tick, or null with no hypothalamus. */
  readonly needs: Needs | null;
  /** Skill lifecycle events, oldest first, at most the last 20. */
  readonly recentEvents: readonly SkillEvent[];
  /** Replaces the goal. `setBy` and `setAt` are filled in for you; the rest default to none. */
  setGoal(goal: Pick<Goal, "text" | "steps" | "reason"> & Partial<Pick<Goal, "wants" | "watchFor" | "ifThen" | "holdBack" | "stepsDone" | "stepDoneAt">>): void;
  /** Drops the goal (e.g. when an alarm cancels the plan). */
  clearGoal(): void;
  setSignal(name: string, value: number): void;
  /** Says what is being attended to (one thing at a time), or null for nothing. */
  setAttended(attended: Attended | null): void;
  /** Shares this tick's reading of the body's needs. */
  setNeeds(needs: Needs | null): void;
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
