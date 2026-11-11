import type { Planner, Region, Workspace } from "@familiar/contracts";

export interface NeocortexOptions {
  /** What makes the plan (an LLM, or a stand-in). */
  planner: Planner;
  /** The situation in plain words, for the planner. */
  describe(ws: Workspace): string;
  /** How often to re-plan, in ms. Default: 15 000. */
  everyMs?: number;
  /** Give up on a plan after this long. Default: 60 000. */
  timeoutMs?: number;
  /** Default: "neocortex". */
  name?: string;
  /** Default: 2 (the slowest layer). */
  layer?: number;
}

/**
 * The slow, deliberate region: in the background, describes the situation to a planner and
 * writes the plan into the workspace as the goal. It only sets goals; it never proposes actions.
 * Faster regions read the goal and decide how to pursue it.
 */
export function createNeocortexRegion(options: NeocortexOptions): Region {
  const { planner, describe, everyMs = 15_000, timeoutMs = 60_000, name = "neocortex", layer = 2 } = options;
  return {
    name,
    layer,
    everyMs,
    timeoutMs,
    async run(ws, signal) {
      const situation = describe(ws);
      const plan = await planner.plan({ situation, currentGoal: ws.goal }, signal);
      ws.setGoal({ text: plan.goal, steps: plan.steps, reason: plan.reason });
      return { proposals: [], trace: { planner: planner.name, situation, plan } };
    },
  };
}
