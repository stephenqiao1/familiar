import type { Proposal, Question, Skill, Workspace, Answer } from "@familiar/contracts";
import { NORADRENALINE, PLANNER_OFFLINE_SIGNAL, PLANNER_WEIGHT_SIGNAL } from "@familiar/neuromodulators";
import { actionProposal, buildActionQuestion, buildTargetQuestion } from "@familiar/region-instinct";
import { PLAYER_CONTEXT, playerQuestions } from "../player-questions.js";
import { menuSkills } from "../skills/index.js";
import { thingsInView } from "./cues.js";
import { minecraftDataOf } from "./read-state.js";

/** What the instinct region needs from the player (everything but the engine). */
export interface PlayerInstinct {
  questions(ws: Workspace): Question[];
  toProposals(answers: Answer[], ws: Workspace): Proposal[];
}

/** Below this weight the planner's goal is passed on as less important than staying safe. */
const GOAL_COUNTS_FULLY = 0.75;
/** With options widened, this many of the engine's options are proposed, down to this probability. */
const WIDE = { maxOptions: 5, minProbability: 0.05 };

/**
 * The player's questions each tick: the usual set, with the current goal (if any) added to the
 * next_action context, as far as the planner's weight allows. The next_action answers become the
 * proposals; `widen` says when to offer more of them (e.g. when search is high). Reflex-only
 * skills are never on the menu, and primitives only with `showPrimitives`.
 */
export function playerInstinct<Ctx>(skills: Skill<Ctx>[], ctx: Ctx, widen: (ws: Workspace) => boolean = () => false, showPrimitives = false): PlayerInstinct {
  const menu = menuSkills(skills, showPrimitives);
  const acceptsTarget = (skill: string, target: string) => skills.find((s) => s.name === skill)?.canRun(ctx, target) ?? false;
  return {
    questions(ws) {
      if (!minecraftDataOf(ws.state)) return [];
      return playerQuestions({
        nextAction: buildActionQuestion(menu, ctx, withGoal(PLAYER_CONTEXT, ws), ws.current?.skill),
        target: buildTargetQuestion(thingsInView(ws.state).map((t) => t.id)),
      });
    },
    toProposals: (answers, ws) => actionProposal(answers, { acceptsTarget, ...(widen(ws) ? WIDE : {}) }),
  };
}

/**
 * The context, plus the current goal and its steps. Alarm can take the planner out of charge: its
 * goal is then marked less important, or left out while the planner is offline. A goal the alarm
 * system set itself (a retreat) always counts fully.
 */
export function withGoal(context: string, ws: Workspace): string {
  const goal = ws.goal;
  if (!goal) return context;
  const ownGoal = goal.setBy === NORADRENALINE;
  const weight = ownGoal ? 1 : (ws.signals[PLANNER_WEIGHT_SIGNAL]?.value ?? 1);
  if (!ownGoal && (ws.signals[PLANNER_OFFLINE_SIGNAL]?.value ?? 0) > 0) return context;
  const steps = goal.steps.length ? ` Steps: ${goal.steps.join("; ")}.` : "";
  const label = weight < GOAL_COUNTS_FULLY ? "Current goal (less important right now than staying safe)" : "Current goal";
  return `${context}\n${label}: ${goal.text}${steps}`;
}
