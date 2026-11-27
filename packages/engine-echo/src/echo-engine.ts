import type { Answer, DecisionEngine, Question, State } from "@familiar/contracts";
import { echoAnswer } from "./echo-answer.js";

export interface EchoEngineOptions {
  /** Fake latency before answering. Default 0. */
  delayMs?: number;
  /**
   * A fixed way of choosing, for scenes that must not depend on a model: given the state, the
   * options it would pick, best first. A choice question gets the first of them it offers (none
   * offered: the usual default). Default: none.
   */
  choose?(state: State): string[];
}

/** How sure the echo engine says it is of a choice made by its fixed rules: as sure as Jev at its surest. */
const SURE = 0.95;

/** A stand-in engine that answers every question with a fixed, safe default (or by fixed rules of choice, when given). */
export class EchoEngine implements DecisionEngine {
  readonly name = "echo";
  private readonly delayMs: number;
  private readonly choose: ((state: State) => string[]) | undefined;

  constructor(options: EchoEngineOptions = {}) {
    this.delayMs = options.delayMs ?? 0;
    this.choose = options.choose;
  }

  async decide(state: State, questions: Question[]): Promise<Answer[]> {
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    const wanted = this.choose?.(state) ?? [];
    return this.answered(questions, this.choose ? wanted.concat("idle") : []).map((question) => {
      const pick = question.kind === "choice" ? wanted.find((option) => question.options.includes(option)) : undefined;
      return pick === undefined ? echoAnswer(question) : { kind: "choice", id: question.id, choice: pick, probabilities: { [pick]: SURE }, confidence: SURE };
    });
  }

  /** With fixed rules of choice it answers only what the rules speak to: no made-up answer to another choice (which thing to aim at). */
  private answered(questions: Question[], wanted: string[]): Question[] {
    return wanted.length ? questions.filter((q) => q.kind !== "choice" || wanted.some((option) => q.options.includes(option))) : questions;
  }
}
