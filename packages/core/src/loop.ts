import type { Action, Answer, DecisionEngine, Question, State, TickLog } from "@familiar/contracts";
import { answersToAction } from "./answers-to-action.js";

export interface LoopOptions {
  engine: DecisionEngine;
  /** Fixed questions, or a function that builds them from each tick's state. */
  questions: Question[] | ((state: State) => Question[]);
  getState: () => State;
  /** May return a promise; the tick waits for it before logging. */
  onAction: (action: Action) => void | Promise<void>;
  logger: { log(entry: TickLog): void };
  intervalMs?: number;
  /** Where tick errors go. Default: console.error. */
  onError?: (error: unknown, tick: number) => void;
  /** Turns answers into an action. Default: answersToAction. */
  toAction?: (answers: Answer[]) => Action;
  /**
   * If given, the state is checked every `watchMs` between ticks, and a tick runs at once when
   * this returns true for (state at the last tick, current state).
   */
  isSignificantChange?: (prev: State, next: State) => boolean;
  /** How often to check for a significant change. Default: 100 ms. */
  watchMs?: number;
  /** Minimum time between two decide calls. Default: 150 ms. */
  minGapMs?: number;
}

export interface Loop {
  start(): void;
  /** Stops scheduling ticks and resolves once any running tick has finished. */
  stop(): Promise<void>;
}

/**
 * Runs one decision tick every `intervalMs`, or sooner on a significant change. Never runs two
 * ticks at once (a tick due while one is running is skipped) and never starts ticks closer
 * together than `minGapMs`.
 */
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
    isSignificantChange,
    watchMs = 100,
    minGapMs = 150,
  } = options;

  let regular: ReturnType<typeof setTimeout> | undefined;
  let watch: ReturnType<typeof setInterval> | undefined;
  let running: Promise<void> | undefined;
  let lastStart = -Infinity;
  let lastState: State | undefined;
  let tick = 0;

  /** The current state, and how long building it took. */
  function readState(): { state: State; encodeMs: number } {
    const started = performance.now();
    const state = getState();
    return { state, encodeMs: performance.now() - started };
  }

  async function runTick(n: number, { state, encodeMs }: { state: State; encodeMs: number }): Promise<void> {
    const timestamp = Date.now();
    lastState = state;
    const asked = typeof questions === "function" ? questions(state) : questions;
    const started = performance.now();
    const answers = await engine.decide(state, asked);
    const engineLatencyMs = engine.lastTiming?.()?.totalMs ?? performance.now() - started;
    const action = toAction(answers);
    await onAction(action);
    logger.log({ tick: n, timestamp, state, questions: asked, answers, encodeMs, engineLatencyMs, action });
  }

  /** Starts a tick now (with an already-read state, if given), and schedules the next regular one. */
  function startTick(read?: { state: State; encodeMs: number }): void {
    scheduleRegular();
    if (running || Date.now() - lastStart < minGapMs) return;
    lastStart = Date.now();
    const n = tick++;
    running = Promise.resolve()
      .then(() => runTick(n, read ?? readState()))
      .catch((error: unknown) => onError(error, n))
      .finally(() => {
        running = undefined;
      });
  }

  function scheduleRegular(): void {
    clearTimeout(regular);
    regular = setTimeout(() => startTick(), intervalMs);
  }

  function checkForChange(): void {
    if (running || !lastState || !isSignificantChange || Date.now() - lastStart < minGapMs) return;
    try {
      const read = readState();
      if (isSignificantChange(lastState, read.state)) startTick(read);
    } catch (error) {
      onError(error, tick);
    }
  }

  return {
    start() {
      if (regular) return;
      scheduleRegular();
      if (isSignificantChange) watch = setInterval(checkForChange, watchMs);
    },
    async stop() {
      clearTimeout(regular);
      clearInterval(watch);
      regular = undefined;
      watch = undefined;
      await running;
    },
  };
}
