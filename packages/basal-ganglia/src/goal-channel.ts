import type { Goal, Workspace } from "@familiar/contracts";

// The goal channel: the contest for what the prefrontal cortex holds. A goal a region offers
// replaces the standing one only if it wins here. The rules, in order:
//   1. a protected goal stands until its own "done when" is true (or it has stood too long);
//   2. a finished goal gives way to anything;
//   3. a region may always revise its own goal;
//   4. otherwise the offered goal must match the standing one's priority.

/** A protected goal is kept at most this long, whatever its "done when" says: nothing can lock the planner out for good. */
export const PROTECTED_MOST_MS = 10 * 60_000;

export interface GoalChannelOptions {
  /** 0: every goal offered replaces the last. Up to 1: how much of the standing goal's priority a rival must match. */
  strength: number;
  /** Whether a goal's own "done when" is true now; null if it has none that can be checked. */
  done(goal: Goal, ws: Workspace): boolean | null;
  /** The longest a protected goal is kept, in ms. Default: ten minutes. */
  protectedMostMs?: number;
}

/** Whether every step of a goal that has steps is finished. */
const stepsFinished = (goal: Goal) => goal.steps.length > 0 && goal.stepsDone >= goal.steps.length;

/** The goal channel as the workspace asks it: why the standing goal is kept (in words), or null when the offered one replaces it. */
export function createGoalChannel(options: GoalChannelOptions): (offered: Goal, standing: Goal, ws: Workspace) => string | null {
  const { strength, protectedMostMs = PROTECTED_MOST_MS } = options;
  return (offered, standing, ws) => {
    if (!(strength > 0)) return null;
    const done = options.done(standing, ws);
    // A goal nobody can tell is finished cannot be protected: it would never give way.
    if (standing.protected && done === false && Date.now() - standing.setAt < protectedMostMs) return `the goal "${standing.text}" is protected until: ${standing.doneWhen}`;
    if (done || stepsFinished(standing) || offered.setBy === standing.setBy) return null;
    const needed = standing.priority - (1 - strength);
    return offered.priority >= needed ? null : `its priority (${offered.priority}) is below the standing goal's (${standing.priority})`;
  };
}
