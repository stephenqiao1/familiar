import type { Answer, DecisionEngine, Question, State } from "@familiar/contracts";
import { TypeSafeClient, type ContentValue } from "@typesafe-ai/sdk";
import { fromJevAnswers } from "./from-jev.js";
import { JevError } from "./jev-error.js";
import { toJevQuestions } from "./to-jev.js";
import { validateQuestions } from "./validate.js";

export interface JevEngineOptions {
  /** Default: the TYPESAFE_API_KEY environment variable. */
  apiKey?: string;
  /** Default: "jev-latest". */
  model?: string;
  /** Per-request limit. Default: 1500 ms. */
  timeoutMs?: number;
  /** HTTP implementation; tests pass a mock. Default: global fetch. */
  fetch?: typeof globalThis.fetch;
}

export interface JevTiming {
  totalMs: number;
}

/** Asks Jev all questions about a state in one request. No retries: a late answer is worse than none. */
export class JevEngine implements DecisionEngine {
  readonly name = "jev";
  private readonly client: TypeSafeClient;
  private readonly model: string;
  private timing: JevTiming | null = null;

  constructor(options: JevEngineOptions = {}) {
    this.model = options.model ?? "jev-latest";
    this.client = new TypeSafeClient({
      ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      timeout: options.timeoutMs ?? 1500,
      retry: { maxRetries: 0 },
    });
  }

  async decide(state: State, questions: Question[]): Promise<Answer[]> {
    validateQuestions(questions);
    const started = performance.now();
    try {
      const result = await this.client.systemOne({
        state: asJson(state),
        questions: toJevQuestions(questions),
        model: this.model,
      });
      return fromJevAnswers(questions, result.answers);
    } catch (error) {
      if (error instanceof JevError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new JevError(`Jev request failed: ${message}`, { cause: error });
    } finally {
      this.timing = { totalMs: performance.now() - started };
    }
  }

  /** Timing of the most recent decide() call, or null before the first. */
  lastTiming(): JevTiming | null {
    return this.timing;
  }
}

/** The state as plain JSON (the API takes JSON values only; this also drops undefined fields). */
function asJson(state: State): { [key: string]: ContentValue } {
  return JSON.parse(JSON.stringify(state)) as { [key: string]: ContentValue };
}
