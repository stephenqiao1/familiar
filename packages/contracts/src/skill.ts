/**
 * What was different after a run: a flat record such as { moved: 1.2, gained: { dirt: 1 } }.
 * `asExpected` says whether the run did what the action said it would when it works.
 */
export type Changes = Record<string, unknown>;

/** A part of the body an action uses. Two actions that share a part cannot run at the same time. */
export type BodyPart = "head" | "legs" | "hands";

/** How a skill run ended. */
export interface SkillResult {
  status: "done" | "failed" | "interrupted";
  reason?: string;
  /** What the run changed, if the skill reports it (primitives do). */
  changes?: Changes;
  /** The thing the run was aimed at, if the skill chose it itself (a chest it picked with no target given). */
  aimedAt?: string;
}

/** A behaviour the agent can perform. `Ctx` is whatever the game side gives skills to act with. */
export interface Skill<Ctx> {
  name: string;
  /** One line. Later used to build Jev's option list. */
  description: string;
  /** Can do harm or put the agent in danger (attacking, entering danger). Patience holds these back. */
  risky?: boolean;
  /** Needs care while it runs (fighting, handling storage). Focus rises for these. */
  demanding?: boolean;
  /** One of the body's built-in actions: tiny, quick, and what learned skills are built from. Off the decision menu by default. */
  primitive?: boolean;
  /** Only reflexes may use it; never on the decision menu. */
  reflexOnly?: boolean;
  /** The body parts it uses. Default: all of them. */
  parts?: BodyPart[];
  /** May run for many seconds (most primitives are over in about one). */
  long?: boolean;
  canRun(ctx: Ctx, target?: string): boolean;
  /** Must stop promptly when `signal` aborts. */
  run(ctx: Ctx, target: string | undefined, signal: AbortSignal): Promise<SkillResult>;
}

/** The skill an executor is running right now. */
export interface RunningSkill {
  skill: string;
  target: string | undefined;
  startedAt: number;
}
