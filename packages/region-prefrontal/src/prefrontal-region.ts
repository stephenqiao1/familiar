import type { Planner, Region, Workspace } from "@familiar/contracts";

export interface PrefrontalOptions {
  /** What makes the plan (an LLM, or a stand-in). */
  planner: Planner;
  /** The situation in plain words, for the planner. */
  describe(ws: Workspace): string;
  /** Extra guidance for this plan: an instruction added to the situation, and a cap on steps. Default: none. */
  guidance?(ws: Workspace): { instruction?: string; maxSteps?: number };
  /** True to skip planning for now (e.g. while an alarm has the planner offline). Default: never. */
  paused?(ws: Workspace): boolean;
  /** True to plan at the next tick without waiting (e.g. to re-plan after an alarm). Default: never. */
  wake?(ws: Workspace): boolean;
  /** How often to re-plan, in ms. Default: 15 000. */
  everyMs?: number;
  /** Give up on a plan after this long. Default: 60 000. */
  timeoutMs?: number;
  /** Default: "prefrontal". */
  name?: string;
  /** Default: 2 (the slowest layer). */
  layer?: number;
}

/** A goal carries at most this many loaded responses. */
const MAX_IF_THEN = 3;
/** A plan may ask to be told in full about this many kinds or ids of things. */
const MAX_DETAIL = 5;

/**
 * The slow, deliberate region: in the background, describes the situation to a planner and
 * writes the plan into the workspace as the goal. It only sets goals; it never proposes actions.
 * Faster regions read the goal and decide how to pursue it.
 *
 * The planner also says how many steps of the goal it was shown are finished. The count carries
 * over while the steps stay the same and starts again at 0 when they change; whenever it goes
 * up, the goal notes the time a step was last finished.
 *
 * A plan can also tune the fastest layer: `ifThen` loads responses to fire on sight, and
 * `holdBack` names soft reflexes to damp. Both last only as long as the goal that set them.
 */
export function createPrefrontalRegion(options: PrefrontalOptions): Region {
  const { planner, describe, everyMs = 15_000, timeoutMs = 60_000, name = "prefrontal", layer = 2 } = options;
  return {
    name,
    layer,
    everyMs,
    timeoutMs,
    dueNow: (ws) => !options.paused?.(ws) && (options.wake?.(ws) ?? false),
    async run(ws, signal) {
      if (options.paused?.(ws)) return { proposals: [], trace: { paused: true } };
      const { instruction, maxSteps } = options.guidance?.(ws) ?? {};
      const cap = maxSteps === undefined ? [] : [`Plan at most ${maxSteps} steps.`];
      const situation = [describe(ws), ...(instruction ? [instruction] : []), ...cap].join("\n");
      const shown = ws.goal;
      const plan = await planner.plan({ situation, currentGoal: shown }, signal);
      const steps = plan.steps.slice(0, maxSteps);
      const reported = Math.min(shown?.steps.length ?? 0, Math.max(0, Math.round(plan.stepsDone ?? 0)));
      const advanced = shown !== null && reported > shown.stepsDone;
      const sameSteps = shown !== null && shown.steps.length === steps.length && shown.steps.every((s, i) => s === steps[i]);
      ws.setGoal({
        text: plan.goal,
        steps,
        reason: plan.reason,
        wants: plan.wants ?? [],
        watchFor: plan.watchFor ?? [],
        ifThen: (plan.ifThen ?? []).slice(0, MAX_IF_THEN),
        holdBack: plan.holdBack ?? [],
        detail: (plan.detail ?? []).slice(0, MAX_DETAIL),
        stepsDone: sameSteps ? Math.max(reported, shown.stepsDone) : 0,
        stepDoneAt: advanced ? Date.now() : (shown?.stepDoneAt ?? null),
      });
      return { proposals: [], trace: { planner: planner.name, situation, plan, ...(advanced ? { stepFinished: true } : {}) } };
    },
  };
}
