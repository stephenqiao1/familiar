import type { Answer, DecisionEngine, Proposal, Question, Region, Workspace } from "@familiar/contracts";
import { answersToAction } from "./answers-to-action.js";
import { ACTION_QUESTION_ID } from "./questions/build-action-question.js";

export interface InstinctOptions {
  /** What answers the questions (Jev, echo, ...). */
  engine: DecisionEngine;
  /** The questions to ask this tick. Read the workspace (e.g. the goal) to shape them. */
  questions(ws: Workspace): Question[];
  /** Turns the answers into proposals. Default: `actionProposal` with no target check. */
  toProposals?(answers: Answer[], ws: Workspace): Proposal[];
  /** Default: "instinct". */
  name?: string;
  /** Default: 1. */
  layer?: number;
  /** Default: none (the engine's own timeout applies). */
  timeoutMs?: number;
}

/**
 * The fast-intuition region: every tick, asks a decision engine a set of questions about the
 * workspace. Every noul and score answer is shared as a signal named after its question
 * (scores scaled to 0..1), so other regions can read e.g. `in_danger`. The trace keeps the
 * questions, answers and engine time.
 */
export function createInstinctRegion(options: InstinctOptions): Region {
  const { engine, questions, toProposals = (answers) => actionProposal(answers), name = "instinct", layer = 1, timeoutMs } = options;
  return {
    name,
    layer,
    everyMs: 0,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    async run(ws) {
      const asked = questions(ws);
      const started = performance.now();
      const answers = await engine.decide(ws.state, asked);
      const engineMs = engine.lastTiming?.()?.totalMs ?? performance.now() - started;
      shareSignals(ws, asked, answers);
      return { proposals: toProposals(answers, ws), trace: { engine: engine.name, engineMs, questions: asked, answers } };
    },
  };
}

export interface ActionProposalOptions {
  /** Whether a skill can use a target; targets it can't use are dropped. */
  acceptsTarget?: (skill: string, target: string) => boolean;
  /** Urgency given at full confidence. Keeping it below 1 leaves room for reflexes. Default: 0.8. */
  maxUrgency?: number;
}

/**
 * One proposal from the next_action (and target) answers, with urgency = confidence × maxUrgency.
 * None if next_action wasn't answered.
 */
export function actionProposal(answers: Answer[], { acceptsTarget, maxUrgency = 0.8 }: ActionProposalOptions = {}): Proposal[] {
  const choice = answers.find((a) => a.kind === "choice" && a.id === ACTION_QUESTION_ID);
  if (choice?.kind !== "choice") return [];
  const action = answersToAction(answers, acceptsTarget);
  const p = choice.probabilities[choice.choice] ?? 0;
  return [
    {
      action,
      urgency: choice.confidence * maxUrgency,
      reason: `chose ${choice.choice} (p=${p.toFixed(2)}, conf=${choice.confidence.toFixed(2)})`,
    },
  ];
}

function shareSignals(ws: Workspace, questions: Question[], answers: Answer[]): void {
  for (const answer of answers) {
    if (answer.kind === "noul") ws.setSignal(answer.id, answer.value);
    if (answer.kind === "score") {
      const q = questions.find((x) => x.id === answer.id);
      if (q?.kind === "score" && q.max > q.min) ws.setSignal(answer.id, (answer.score - q.min) / (q.max - q.min));
    }
  }
}
