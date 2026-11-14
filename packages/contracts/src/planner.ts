import type { Goal, ItemWant } from "./brain.js";

/** What a planner is asked: the situation in words, and the goal it set last time. */
export interface PlanRequest {
  situation: string;
  currentGoal: Goal | null;
}

/** A planner's answer. */
export interface Plan {
  goal: string;
  steps: string[];
  reason: string;
  /** What to carry for this goal. Default: nothing. */
  wants?: ItemWant[];
  /** Kinds of things to watch for while pursuing this goal. Default: none. */
  watchFor?: string[];
  /** How many steps of the goal it was shown (`currentGoal`) are finished now. Default: 0. */
  stepsDone?: number;
}

/** Anything that turns a described situation into a goal (e.g. an LLM). */
export interface Planner {
  name: string;
  plan(request: PlanRequest, signal?: AbortSignal): Promise<Plan>;
}
