import type { Answer, DecisionEngine, Question, State } from "@familiar/contracts";
import { echoAnswer } from "./echo-answer.js";

export interface EchoEngineOptions {
  /** Fake latency before answering. Default 0. */
  delayMs?: number;
}

/** A stand-in engine that answers every question with a fixed, safe default. */
export class EchoEngine implements DecisionEngine {
  readonly name = "echo";
  private readonly delayMs: number;

  constructor(options: EchoEngineOptions = {}) {
    this.delayMs = options.delayMs ?? 0;
  }

  async decide(_state: State, questions: Question[]): Promise<Answer[]> {
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return questions.map(echoAnswer);
  }
}
