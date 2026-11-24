import type { Answer, DecisionEngine, Proposal, Question, Region, Workspace } from "@familiar/contracts";
import { actionFor } from "./answers-to-action.js";
import { ACTION_QUESTION_ID } from "./questions/build-action-question.js";

export interface InstinctOptions {
  /** What answers the questions (Jev, echo, ...). */
  engine: DecisionEngine;
  /** The questions to ask this tick. Read the workspace (e.g. the goal) to shape them. */
  questions(ws: Workspace): Question[];
  /** Turns the answers into proposals. Default: `actionProposal` with no target check. */
  toProposals?(answers: Answer[], ws: Workspace): Proposal[];
  /** True to skip this tick without asking the engine (e.g. while asleep). Default: never. */
  paused?(ws: Workspace): boolean;
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
      if (options.paused?.(ws)) return { proposals: [], trace: { paused: true } };
      const asked = questions(ws);
      const started = performance.now();
      // The engine is shown what this reader is told (the thalamus's view), not the full state.
      const answers = await engine.decide(ws.view(name), asked);
      const engineMs = engine.lastTiming?.()?.totalMs ?? performance.now() - started;
      shareSignals(ws, asked, answers);
      return { proposals: toProposals(answers, ws), trace: { engine: engine.name, engineMs, questions: asked, answers } };
    },
  };
}

export interface ActionProposalOptions {
  /** Whether a skill can use a target; targets it can't use are dropped. */
  acceptsTarget?: (skill: string, target: string) => boolean;
  /** Urgency given at probability 1. Keeping it below 1 leaves room for reflexes. Default: 0.8. */
  maxUrgency?: number;
  /** Most options to propose. Default: 3. */
  maxOptions?: number;
  /** Options less likely than this are left out. Default: 0.1. */
  minProbability?: number;
}

/**
 * The engine's most likely next_action options (and the target, for skills that accept it), one
 * proposal each, with urgency = probability × maxUrgency. Offering a few options, not just the
 * top one, lets the arbiter weigh them. None if next_action wasn't answered.
 */
export function actionProposal(answers: Answer[], options: ActionProposalOptions = {}): Proposal[] {
  const { acceptsTarget, maxUrgency = 0.8, maxOptions = 3, minProbability = 0.1 } = options;
  const choice = answers.find((a) => a.kind === "choice" && a.id === ACTION_QUESTION_ID);
  if (choice?.kind !== "choice") return [];
  return Object.entries(choice.probabilities)
    .filter(([, p]) => p >= minProbability)
    .sort(([, a], [, b]) => b - a)
    .slice(0, maxOptions)
    .map(([skill, p]) => ({
      action: actionFor(skill, answers, acceptsTarget),
      urgency: p * maxUrgency,
      reason: `${skill === choice.choice ? "chose" : "option"} ${skill} (p=${p.toFixed(2)}, conf=${choice.confidence.toFixed(2)})`,
    }));
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
