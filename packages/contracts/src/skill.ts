/** How a skill run ended. */
export interface SkillResult {
  status: "done" | "failed" | "interrupted";
  reason?: string;
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
