import type { Proposal, Question, Skill, Workspace, Answer } from "@familiar/contracts";
import { actionProposal, buildActionQuestion, buildTargetQuestion } from "@familiar/region-instinct";
import { listTargets } from "../encode/list-targets.js";
import { MINER_CONTEXT, minerQuestions } from "../miner-questions.js";
import { minecraftData } from "./read-state.js";

/** What the instinct region needs from the Miner (everything but the engine). */
export interface MinerInstinct {
  questions(ws: Workspace): Question[];
  toProposals(answers: Answer[], ws: Workspace): Proposal[];
}

/**
 * The Miner's questions each tick: the usual set, with the neocortex's current goal (if any)
 * added to the next_action context. The next_action answer becomes the proposal.
 */
export function minerInstinct<Ctx>(skills: Skill<Ctx>[], ctx: Ctx): MinerInstinct {
  const acceptsTarget = (skill: string, target: string) => skills.find((s) => s.name === skill)?.canRun(ctx, target) ?? false;
  return {
    questions(ws) {
      if (!minecraftData(ws)) return [];
      return minerQuestions({
        nextAction: buildActionQuestion(skills, ctx, withGoal(MINER_CONTEXT, ws)),
        target: buildTargetQuestion(listTargets(ws.state)),
      });
    },
    toProposals: (answers) => actionProposal(answers, { acceptsTarget }),
  };
}

/** The context, plus the current goal and its steps. */
export function withGoal(context: string, ws: Workspace): string {
  if (!ws.goal) return context;
  const steps = ws.goal.steps.length ? ` Steps: ${ws.goal.steps.join("; ")}.` : "";
  return `${context}\nCurrent goal: ${ws.goal.text}${steps}`;
}
