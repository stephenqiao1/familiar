import type { Goal } from "./brain.js";

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
}

/** Anything that turns a described situation into a goal (e.g. an LLM). */
export interface Planner {
  name: string;
  plan(request: PlanRequest, signal?: AbortSignal): Promise<Plan>;
}
