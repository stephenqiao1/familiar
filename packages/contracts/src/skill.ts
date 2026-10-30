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
