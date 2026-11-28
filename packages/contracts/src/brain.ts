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

/** One step of a goal, as the motor area carries it out. */
export interface Step {
  text: string;
  /** The skill that does it: the motor area proposes it. Left out: instinct is given the step as its focus. */
  skill?: string;
  /** What the skill is aimed at, in the skill's own target words. */
  target?: string;
  /** A condition in the game side's vocabulary: the step is finished the tick it comes true. */
  doneWhen?: string;
  /** A condition in the same vocabulary: the step is stuck once it is true. */
  giveUpWhen?: string;
}

/** One soft reflex a goal holds back, how strongly, and until when. */
export interface HoldBack {
  /** The reflex's name, or the skill it proposes. */
  name: string;
  /** 0 (not at all) to 1 (as far as a reflex can be held back). */
  strength: number;
  /** When it ends: "step" (when the step under way as it was set is finished) or a number of seconds. Left out: with the goal. */
  until?: "step" | number;
  /** The step that was under way when it was set, and when that was (ms). Filled in for you. */
  step?: number;
  since?: number;
}

/** Something the planner says to expect: `what` should hold whenever `when` does (always, with no `when`). Both are conditions in the game side's vocabulary. */
export interface Expectation {
  what: string;
  when?: string;
}

/** A goal written by a planning region. Other regions read it to guide their choices. */
export interface Goal {
  text: string;
  /** Each step's text, in order. */
  steps: string[];
  /** The steps in full, one for each of `steps`. */
  specs: Step[];
  reason: string;
  /** How much it matters, 0 to 1: what the motor area's proposals for it are worth, and what a rival goal must match to replace it. */
  priority: number;
  /** A protected goal is not replaced until its own `doneWhen` is true. */
  protected: boolean;
  /** A condition (in the game side's vocabulary) that says the whole goal is finished, or null. */
  doneWhen: string | null;
  /** What to carry for this goal: taking from storage fetches these, storing keeps them. */
  wants: ItemWant[];
  /** Kinds of things to watch for (e.g. "chest", "villager"): spotting one is a cue to act. */
  watchFor: string[];
  /** Responses loaded in advance (at most 3), fired by the fastest layer the moment their thing appears. */
  ifThen: IfThen[];
  /** Soft reflexes to hold back while this goal is active. */
  holdBack: HoldBack[];
  /** Kinds or ids of things the planner wants to be told about in full (at most 5 count): the thalamus opens their channel. */
  detail: string[];
  /** What to expect while this goal stands (at most 3): the sensory area reports one that does not hold. */
  expect: Expectation[];
  /** How many of `steps` the planner has judged finished. */
  stepsDone: number;
  /** When a step (of this goal or an earlier one) was last judged finished, or null if never. */
  stepDoneAt: number | null;
  /** The region that set it. */
  setBy: string;
  setAt: number;
}

/** What the area above tells an area of the cortex: what it is working toward and what to expect. */
export interface Feedback {
  /** The goal being held, or null with none. */
  goal: Goal | null;
  /** The step to attend to now, when the area above leaves it to the one below. Left out: none in particular. */
  step?: { index: number; text: string } | null;
}

/** A goal as a region offers it: the fields left out take their defaults. */
export type GoalOffer = Pick<Goal, "text" | "reason"> & { steps: (string | Step)[]; holdBack?: (string | HoldBack)[] } & Partial<Pick<Goal, "wants" | "watchFor" | "ifThen" | "detail" | "expect" | "stepsDone" | "stepDoneAt" | "priority" | "protected" | "doneWhen">>;

/** What one area of the cortex last said on the ports that other regions read. */
export interface AreaPorts {
  /** What it reported to the area above (what it found, and any surprise), or null. */
  up: Record<string, unknown> | null;
  /** What it tells the area below, or null. */
  feedback: Feedback | null;
  /** What it wants the thalamus to send it next: kinds or ids of things to be told of in full. */
  ask: string[];
  /** When it last said so (ms). */
  at: number;
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
  /** How much harm it predicts here and now, as the amygdala has learned (-0.5 a sign of safety, to 1). Left out if nothing has said. */
  harm?: number;
}

/** Where the agent is, as the hippocampus's map has it. */
export interface PlaceNow {
  /** The map cell it is in. */
  cell: string;
  /** The area that cell belongs to (a cave, a house, a field): the "where" for learning. */
  area: string;
  /** How well it knows this cell, 0 (never been) to 1. */
  familiarity: number;
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

/** One thing the body feels: a word for it, how strongly (0 to 1), and the reading it comes from. */
export interface Felt {
  word: string;
  strength: number;
  from: string;
}

/** How the bot feels right now, as the insula read it from the body's own readings. It only restates them. */
export interface Feeling {
  /** What it feels, strongest first. Empty when nothing presses (it is at ease). */
  feelings: Felt[];
  /** How good the body's state is overall, 0 (very bad) to 1. */
  comfort: number;
  /** Comfort and recent surprises averaged over minutes, -1 (low) to 1 (high). */
  mood: number;
  /** The body did something nothing explains: how strongly (0 to 1), and which readings. */
  uneasy: { level: number; about: string[] };
  /** The feeling in a few words, for the deciding layers ("very hungry, a little hurt, uneasy"). */
  line: string;
}

/** One event behind the trouble: the kinds of sign it showed (its faces), what it concerns, how strong it is now, and how old it is. */
export interface TroubleEvent {
  kinds: string[];
  about: string[];
  /** 0 to 1: its strongest face right now. */
  strength: number;
  /** Ms since its first sign. */
  age: number;
}

/** What the cingulate makes of the trouble: put in more effort, go on as it is, or drop what it is doing. */
export type Verdict = "try harder" | "carry on" | "leave it";

/** The cingulate's reading this tick: how much trouble there is, whether more effort is worth it, and a few numbers beside. */
export interface Trouble {
  /** 0 to 1: every sign of trouble gathered, one event counted once. */
  level: number;
  events: TroubleEvent[];
  /** 0 to 1: how much more effort is worth, trouble × stake × chance − cost. */
  control: number;
  verdict: Verdict;
  /** 0 to 1: how far the running activity is paying worse than things have in general. */
  leave: number;
  /** 0 to 1: how far recent surprises run above the usual. */
  changeable: number;
  /** While the bot is looking inward (at quiet rest with no trouble): when this spell began. Left out otherwise. */
  inward?: number;
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
  /** Where the agent is on its own map, or null with no map. */
  readonly place: PlaceNow | null;
  /** How the agent feels, as the insula read it this tick, or null with no insula. */
  readonly feeling: Feeling | null;
  /** The cingulate's reading of trouble this tick, or null with no cingulate. */
  readonly trouble: Trouble | null;
  /** What each area of the cortex last said to its neighbours, by area name: areas talk only through this. */
  readonly cortex: Readonly<Record<string, AreaPorts>>;
  /** Skill lifecycle events, oldest first, at most the last 20. */
  readonly recentEvents: readonly SkillEvent[];
  /**
   * The state as one reader should see it: the latest view the thalamus built for it (at most a
   * tick old), or the full state if none was built. Only the deciding layers ask for a view;
   * every other region reads `state`.
   */
  view(reader: string): State;
  /** Stores the view of the state built for one reader (null: none, so it reads the full state). */
  setView(reader: string, view: State | null): void;
  /**
   * Offers a goal. `setBy` and `setAt` are filled in for you; the rest default to none (priority
   * 0.5, not protected). It replaces the standing goal unless the goal channel keeps that one:
   * then nothing changes and the reason is returned.
   */
  setGoal(goal: GoalOffer): string | void;
  /** Marks the goal's current step finished (now), leaving the rest of the goal as it is. */
  finishStep(): void;
  /** Drops the goal (e.g. when an alarm cancels the plan). */
  clearGoal(): void;
  setSignal(name: string, value: number): void;
  /** Says what is being attended to (one thing at a time), or null for nothing. */
  setAttended(attended: Attended | null): void;
  /** Shares this tick's reading of the body's needs. */
  setNeeds(needs: Needs | null): void;
  /** Writes one area's ports (the ones left out are emptied). */
  setCortex(area: string, ports: Partial<Pick<AreaPorts, "up" | "feedback" | "ask">>): void;
  /** Shares the cingulate's reading of trouble. */
  setTrouble(trouble: Trouble | null): void;
  /** Shares how the agent feels. */
  setFeeling(feeling: Feeling | null): void;
  /** Shares where the agent is on its map. */
  setPlace(place: PlaceNow | null): void;
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
  /**
   * Optional: every winner at once, for an arbiter that runs a contest for each part of the body.
   * It is given every candidate (it sorts out itself which run alongside), and `early` when
   * `settledEarly` already gave the action. With this, the loop's `alongside.isSide` is not asked.
   */
  choose?(candidates: Candidate[], ws: Workspace, early?: Candidate | null): { winner: Candidate | null; alongside: Candidate[] };
  /** Optional: asks for the next tick within this many ms (a wait that must end on time), or null. */
  againInMs?(): number | null;
  /** What the last choice weighed (every candidate and what moved its score), for the log. Default: nothing is logged. */
  trace?(): Record<string, unknown> | undefined;
}
