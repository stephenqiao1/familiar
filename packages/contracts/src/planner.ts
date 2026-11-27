import type { Expectation, Goal, HoldBack, IfThen, ItemWant, Step } from "./brain.js";

/** What a planner is asked: the situation in words, and the goal it set last time. */
export interface PlanRequest {
  situation: string;
  currentGoal: Goal | null;
  /** The notes it has kept (its working memory), each a key and a line. Left out when it keeps none. */
  notes?: { key: string; text: string }[];
  /** Why it is asked now and not at its usual time (a step is stuck), in words. Left out when asked on the clock. */
  woken?: string;
}

/** A planner's answer. */
export interface Plan {
  goal: string;
  /** Each step as text alone, or in full (a skill, a target, a "done when"). */
  steps: (string | Step)[];
  reason: string;
  /** How much the goal matters, 0 to 1. Default: 0.5. */
  priority?: number;
  /** What to carry for this goal. Default: nothing. */
  wants?: ItemWant[];
  /** Kinds of things to watch for while pursuing this goal. Default: none. */
  watchFor?: string[];
  /** Responses to load in advance: when the thing appears, do the skill at once. At most 3. Default: none. */
  ifThen?: IfThen[];
  /** Soft reflexes to hold back while pursuing this goal: a name (in full, for as long as the goal), or with a strength and an end. Default: none. */
  holdBack?: (string | Pick<HoldBack, "name" | "strength" | "until">)[];
  /** Kinds or ids of things to be told about in full from now on (what it is shown is a selection). At most 5. Default: none. */
  detail?: string[];
  /** What to expect while pursuing this goal: the sensory area reports one that does not hold. At most 3. Default: none. */
  expect?: Expectation[];
  /** The notes to keep from now on: each one it was shown that it still wants (as it is, or with new text), and any new one. One it leaves out three plans running is dropped. Default: none. */
  notes?: { key: string; text: string }[];
  /** Keys of notes to drop at once. Default: none. */
  dropNotes?: string[];
  /** How many steps of the goal it was shown (`currentGoal`) are finished now. Default: 0. */
  stepsDone?: number;
}

/** A routine the bot has found to work, to be given a name: its steps in order, and what it brings about. */
export interface NameRequest {
  steps: { skill: string; target?: string }[];
  doneWhen: string;
  /** Names that are already in use. */
  taken: string[];
}

/** Anything that turns a described situation into a goal (e.g. an LLM). */
export interface Planner {
  name: string;
  plan(request: PlanRequest, signal?: AbortSignal): Promise<Plan>;
  /** Names a routine in one word and describes it in one line. Optional: without it the routine is named after its steps. */
  nameRoutine?(request: NameRequest, signal?: AbortSignal): Promise<{ name: string; description: string }>;
}
