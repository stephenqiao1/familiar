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
    onAction: (a) => {
      actions.push(a);
    },
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

  it("builds questions from each tick's state when given a function", async () => {
    const seen: number[] = [];
    const logs: TickLog[] = [];
    const loop = createLoop({
      engine: new EchoEngine(),
      questions: (state) => {
        seen.push(state.tick);
        return [{ kind: "choice", id: "next_action", prompt: "?", options: [`skill_${state.tick}`] }];
      },
      getState: (): State => ({ schemaVersion: 1, tick: seen.length * 10, timestamp: 0, data: {} }),
      onAction: () => {},
      logger: { log: (e) => logs.push(e) },
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(1000);
    await loop.stop();

    expect(seen).toEqual([0, 10]);
    expect(logs.map((l) => l.action)).toEqual([{ skill: "skill_0" }, { skill: "skill_10" }]);
    expect(logs[1]!.questions[0]).toMatchObject({ options: ["skill_10"] });
  });

  it("waits for an async onAction before logging the tick", async () => {
    const order: string[] = [];
    const loop = createLoop({
      engine: new EchoEngine(),
      questions,
      getState: (): State => ({ schemaVersion: 1, tick: 0, timestamp: 0, data: {} }),
      onAction: async () => {
        await new Promise((r) => setTimeout(r, 50));
        order.push("action done");
      },
      logger: { log: () => order.push("logged") },
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(600);
    await loop.stop();
    expect(order).toEqual(["action done", "logged"]);
  });

  describe("early trigger", () => {
    /** A world whose `danger` the test can bump; a change in danger is significant. */
    function earlySetup(engine: DecisionEngine = new EchoEngine()) {
      const world = { danger: 0 };
      const logs: TickLog[] = [];
      const loop = createLoop({
        engine,
        questions,
        getState: (): State => ({ schemaVersion: 1, tick: 0, timestamp: Date.now(), data: { danger: world.danger } }),
        onAction: () => {},
        logger: { log: (e) => logs.push(e) },
        isSignificantChange: (prev, next) => prev.data.danger !== next.data.danger,
      });
      return { loop, logs, world };
    }

    it("ticks at once on a significant change instead of waiting for the timer", async () => {
      const { loop, logs, world } = earlySetup();
      loop.start();
      await vi.advanceTimersByTimeAsync(550); // regular tick 0 at 500
      expect(logs).toHaveLength(1);

      world.danger = 1;
      await vi.advanceTimersByTimeAsync(150); // 700: first watch check 150+ ms after the last tick sees it
      expect(logs.map((l) => l.state.data.danger)).toEqual([0, 1]);
      await loop.stop();
    });

    it("restarts the regular timer after an early tick", async () => {
      const { loop, logs, world } = earlySetup();
      loop.start();
      await vi.advanceTimersByTimeAsync(550);
      world.danger = 1;
      await vi.advanceTimersByTimeAsync(150); // early tick at 700
      await vi.advanceTimersByTimeAsync(450); // 1150: the 1000 tick was replaced by one at 1200
      expect(logs).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(50);
      expect(logs).toHaveLength(3);
      await loop.stop();
    });

    it("keeps at least 150 ms between decide calls", async () => {
      const { loop, logs, world } = earlySetup();
      loop.start();
      await vi.advanceTimersByTimeAsync(500); // tick at 500
      world.danger = 1;
      await vi.advanceTimersByTimeAsync(100); // 600: only 100 ms since the last call, so wait
      expect(logs).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(100); // 700: 200 ms since, so tick
      expect(logs).toHaveLength(2);
      await loop.stop();
    });

    it("never starts a second decide while one is in flight", async () => {
      const { loop, logs, world } = earlySetup(new EchoEngine({ delayMs: 400 }));
      loop.start();
      await vi.advanceTimersByTimeAsync(500); // tick 0 starts at 500, runs until 900
      world.danger = 1;
      await vi.advanceTimersByTimeAsync(300); // 800: still running
      expect(logs).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(200); // 900 finishes; 1000 watch sees the change
      expect(logs).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(400);
      expect(logs.map((l) => l.state.data.danger)).toEqual([0, 1]);
      await loop.stop();
    });
  });

  it("logs encodeMs, and the engine's own latency when it reports one", async () => {
    const logs: TickLog[] = [];
    const timed: DecisionEngine = {
      name: "timed",
      decide: (s, q) => new EchoEngine().decide(s, q),
      lastTiming: () => ({ totalMs: 123 }),
    };
    const loop = createLoop({
      engine: timed,
      questions,
      getState: (): State => ({ schemaVersion: 1, tick: 0, timestamp: 0, data: {} }),
      onAction: () => {},
      logger: { log: (e) => logs.push(e) },
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(500);
    await loop.stop();
    expect(logs[0]).toMatchObject({ engineLatencyMs: 123, encodeMs: expect.any(Number) });
  });
});
