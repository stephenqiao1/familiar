import type { Action, Answer, DecisionEngine, Question, State, TickLog } from "@familiar/contracts";
import { answersToAction } from "./answers-to-action.js";

export interface LoopOptions {
  engine: DecisionEngine;
  questions: Question[];
  getState: () => State;
  onAction: (action: Action) => void;
  logger: { log(entry: TickLog): void };
  intervalMs?: number;
  /** Where tick errors go. Default: console.error. */
  onError?: (error: unknown, tick: number) => void;
  /** Turns answers into an action. Default: answersToAction. */
  toAction?: (answers: Answer[]) => Action;
}

export interface Loop {
  start(): void;
  /** Stops scheduling ticks and resolves once any running tick has finished. */
  stop(): Promise<void>;
}

/** Runs one decision tick every `intervalMs`, skipping a tick while the previous one is still running. */
export function createLoop(options: LoopOptions): Loop {
  const {
    engine,
    questions,
    getState,
    onAction,
    logger,
    intervalMs = 500,
    onError = (error, tick) => console.error(`[loop] tick ${tick} failed:`, error),
    toAction = answersToAction,
  } = options;

  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<void> | undefined;
  let tick = 0;

  async function runTick(n: number): Promise<void> {
    const timestamp = Date.now();
    const state = getState();
    const started = performance.now();
    const answers = await engine.decide(state, questions);
    const engineLatencyMs = performance.now() - started;
    const action = toAction(answers);
    onAction(action);
    logger.log({ tick: n, timestamp, state, questions, answers, engineLatencyMs, action });
  }

  function onInterval(): void {
    if (running) return;
    const n = tick++;
    running = runTick(n)
      .catch((error: unknown) => onError(error, n))
      .finally(() => {
        running = undefined;
      });
  }

  return {
    start() {
      if (!timer) timer = setInterval(onInterval, intervalMs);
    },
    async stop() {
      clearInterval(timer);
      timer = undefined;
      await running;
    },
  };
}
