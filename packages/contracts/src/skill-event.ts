import type { Changes } from "./skill.js";

/** A change in a skill's lifecycle. */
export interface SkillEvent {
  skill: string;
  target?: string;
  type: "started" | "done" | "failed" | "interrupted";
  reason?: string;
  /** What the run changed, on the event that ends it, if the skill reported it. */
  changes?: Changes;
  /** On the event that ends a run: the thing it was aimed at, if the skill chose it itself. */
  aimedAt?: string;
  /** The region whose proposal started the run (left out when nothing says: a typed command). */
  by?: string;
  /** True for a movement that ran alongside the main skill, using other body parts. */
  alongside?: true;
  timestamp: number;
}
