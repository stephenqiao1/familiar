import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Action, DecisionEngine, Question, State, TickLog } from "@familiar/contracts";
import { EchoEngine } from "@familiar/engine-echo";
import { createLoop } from "./loop.js";

const questions: Question[] = [
  { kind: "choice", id: "next_action", prompt: "What next?", options: ["mine", "idle"] },
];

function setup(engine: DecisionEngine = new EchoEngine()) {
  const logs: TickLog[] = [];
  const actions: Action[] = [];
  const errors: unknown[] = [];
  let calls = 0;
  const loop = createLoop({
    engine,
    questions,
    getState: (): State => ({ schemaVersion: 1, tick: calls++, timestamp: Date.now(), data: {} }),
    onAction: (a) => actions.push(a),
    logger: { log: (e) => logs.push(e) },
    intervalMs: 500,
    onError: (e) => errors.push(e),
  });
  return { loop, logs, actions, errors };
}

describe("createLoop", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("logs one entry per tick and acts on the engine's choice", async () => {
    const { loop, logs, actions } = setup();
    loop.start();
    await vi.advanceTimersByTimeAsync(2500);
    await loop.stop();

    expect(logs).toHaveLength(5);
    expect(logs.map((l) => l.tick)).toEqual([0, 1, 2, 3, 4]);
    expect(actions).toContainEqual({ skill: "idle" });
    expect(logs[0]!.action).toEqual({ skill: "idle" });
  });

  it("skips ticks while decide is still running", async () => {
    const { loop, logs } = setup(new EchoEngine({ delayMs: 1200 }));
    loop.start();
    // Tick 0 runs 500–1700, so the intervals at 1000 and 1500 are skipped; tick 1 starts at 2000.
    await vi.advanceTimersByTimeAsync(2500);
    expect(logs.map((l) => l.tick)).toEqual([0]);

    await vi.advanceTimersByTimeAsync(800);
    expect(logs.map((l) => l.tick)).toEqual([0, 1]);
    await loop.stop();
  });

  it("reports a failing tick and keeps running", async () => {
    let fail = true;
    const flaky: DecisionEngine = {
      name: "flaky",
      decide: async (s, q) => {
        if (fail) {
          fail = false;
          throw new Error("boom");
        }
        return new EchoEngine().decide(s, q);
      },
    };
    const { loop, logs, errors } = setup(flaky);
    loop.start();
    await vi.advanceTimersByTimeAsync(1000);
    await loop.stop();

    expect(errors).toHaveLength(1);
    expect(logs.map((l) => l.tick)).toEqual([1]);
  });
});
