import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Action, Region, RegionOutput, State, TickLog, Workspace } from "@familiar/contracts";
import { highestUrgency } from "@familiar/arbiter";
import { createBrainLoop, type BrainLoopOptions } from "./brain-loop.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A per-tick region that always proposes `skill` at `urgency`, after `delayMs`. */
function proposer(name: string, layer: number, skill: string, urgency: number, delayMs = 0): Region {
  return {
    name,
    layer,
    everyMs: 0,
    async run(): Promise<RegionOutput> {
      if (delayMs) await wait(delayMs);
      return { proposals: [{ action: { skill }, urgency, reason: `${name} says ${skill}` }] };
    },
  };
}

function setup(regions: Region[], extra: Partial<BrainLoopOptions> = {}) {
  const logs: TickLog[] = [];
  const actions: { action: Action; at: number }[] = [];
  const errors: unknown[] = [];
  let calls = 0;
  const loop = createBrainLoop({
    regions,
    arbiter: highestUrgency,
    getState: (): State => ({ schemaVersion: 1, tick: calls++, timestamp: Date.now(), data: {} }),
    onAction: (action) => {
      actions.push({ action, at: Date.now() });
    },
    logger: { log: (e) => logs.push(e) },
    onError: (e) => errors.push(e),
    ...extra,
  });
  return { loop, logs, actions, errors };
}

describe("createBrainLoop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it("acts on the most urgent proposal and logs every region", async () => {
    const { loop, logs, actions } = setup([proposer("reflex", 0, "flee", 0.2), proposer("instinct", 1, "mine", 0.6)]);
    loop.start();
    await vi.advanceTimersByTimeAsync(1000);
    await loop.stop();

    expect(logs.map((l) => l.tick)).toEqual([0, 1]);
    expect(actions[0]!.action).toEqual({ skill: "mine" });
    expect(logs[0]!.winner).toMatchObject({ region: "instinct", urgency: 0.6 });
    expect(logs[0]!.regions.map((r) => r.region)).toEqual(["reflex", "instinct"]);
  });

  it("keeps going when no region proposes anything", async () => {
    const quiet: Region = { name: "quiet", layer: 0, everyMs: 0, run: () => ({ proposals: [] }) };
    const { loop, logs } = setup([quiet]);
    loop.start();
    await vi.advanceTimersByTimeAsync(500);
    await loop.stop();
    expect(logs[0]).toMatchObject({ winner: null, action: { keepGoing: true } });
  });

  it("acts on a full-urgency reflex without waiting for slower regions", async () => {
    const { loop, logs, actions } = setup([proposer("reflex", 0, "flee", 1), proposer("instinct", 1, "mine", 0.9, 300)]);
    loop.start();
    await vi.advanceTimersByTimeAsync(500); // tick starts at 500
    expect(actions.map((a) => [a.action, a.at])).toEqual([[{ skill: "flee" }, 500]]);
    expect(logs).toHaveLength(0); // the tick still waits for instinct before logging
    await vi.advanceTimersByTimeAsync(300);
    expect(logs[0]).toMatchObject({ action: { skill: "flee" }, winner: { region: "reflex" } });
    expect(logs[0]!.regions.map((r) => r.region)).toEqual(["reflex", "instinct"]);
    await loop.stop();
  });

  it("logs a failing region and still acts on the others", async () => {
    const broken: Region = {
      name: "broken",
      layer: 0,
      everyMs: 0,
      run: () => {
        throw new Error("boom");
      },
    };
    const { loop, logs, errors } = setup([broken, proposer("instinct", 1, "mine", 0.5)]);
    loop.start();
    await vi.advanceTimersByTimeAsync(500);
    await loop.stop();
    expect(errors).toEqual([]);
    expect(logs[0]!.regions[0]).toMatchObject({ region: "broken", error: "boom", proposals: [] });
    expect(logs[0]!.action).toEqual({ skill: "mine" });
  });

  it("gives up on a region after its timeout", async () => {
    const slow = { ...proposer("slow", 1, "mine", 1, 5000), timeoutMs: 200 };
    const { loop, logs } = setup([slow]);
    loop.start();
    await vi.advanceTimersByTimeAsync(700);
    await loop.stop();
    expect(logs[0]!.regions[0]).toMatchObject({ region: "slow", error: "timed out after 200 ms" });
    expect(logs[0]!.action).toEqual({ keepGoing: true });
  });

  it("clamps urgency to 0..1", async () => {
    const { loop, logs } = setup([proposer("loud", 0, "flee", 7)]);
    loop.start();
    await vi.advanceTimersByTimeAsync(500);
    await loop.stop();
    expect(logs[0]!.winner?.urgency).toBe(1);
  });

  it("rejects two regions with the same name", () => {
    expect(() => setup([proposer("a", 0, "x", 1), proposer("a", 1, "y", 1)])).toThrow(/Two regions/);
  });

  describe("background regions", () => {
    /** Writes a goal every `everyMs`, taking `delayMs`; counts its runs. */
    function planner(everyMs: number, delayMs: number) {
      const runs: number[] = [];
      const region: Region = {
        name: "neocortex",
        layer: 2,
        everyMs,
        async run(ws: Workspace) {
          runs.push(Date.now());
          await wait(delayMs);
          ws.setGoal({ text: `goal ${runs.length}`, steps: [], reason: "test" });
          return { proposals: [] };
        },
      };
      return { region, runs };
    }

    it("never makes a tick wait, and shares its goal through the workspace", async () => {
      const { region, runs } = planner(10_000, 1200);
      const seen: (string | undefined)[] = [];
      const reader: Region = {
        name: "instinct",
        layer: 1,
        everyMs: 0,
        run(ws) {
          seen.push(ws.goal?.text);
          return { proposals: [] };
        },
      };
      const { loop, logs } = setup([reader, region]);
      loop.start();
      await vi.advanceTimersByTimeAsync(2000); // ticks at 500, 1000, 1500, 2000; planner done at 1700
      await loop.stop();

      expect(runs).toEqual([500]);
      expect(logs.map((l) => l.tick)).toEqual([0, 1, 2, 3]);
      expect(seen).toEqual([undefined, undefined, undefined, "goal 1"]);
      expect(logs[3]!.goal).toMatchObject({ text: "goal 1", setBy: "neocortex" });
      expect(logs[3]!.regions).toContainEqual(expect.objectContaining({ region: "neocortex", background: true }));
    });

    it("runs again once everyMs has passed", async () => {
      const { region, runs } = planner(1000, 10);
      const { loop } = setup([region]);
      loop.start();
      await vi.advanceTimersByTimeAsync(2600);
      await loop.stop();
      expect(runs).toEqual([500, 1500, 2500]);
    });

    it("keeps its proposals in play until it runs again", async () => {
      const urger: Region = { ...proposer("urger", 2, "sleep", 0.7), everyMs: 60_000 };
      const { loop, logs } = setup([urger, proposer("instinct", 1, "mine", 0.5)]);
      loop.start();
      await vi.advanceTimersByTimeAsync(1500);
      await loop.stop();
      // Tick 0 starts the run; ticks 1 and 2 see its proposal.
      expect(logs.map((l) => l.action)).toEqual([{ skill: "mine" }, { skill: "sleep" }, { skill: "sleep" }]);
    });
  });

  describe("early trigger", () => {
    function earlySetup(regions: Region[]) {
      const world = { danger: 0 };
      const logs: TickLog[] = [];
      const loop = createBrainLoop({
        regions,
        arbiter: highestUrgency,
        getState: (): State => ({ schemaVersion: 1, tick: 0, timestamp: Date.now(), data: { danger: world.danger } }),
        onAction: () => {},
        logger: { log: (e) => logs.push(e) },
        isSignificantChange: (prev, next) => prev.data.danger !== next.data.danger,
      });
      return { loop, logs, world };
    }

    it("ticks at once on a significant change instead of waiting for the timer", async () => {
      const { loop, logs, world } = earlySetup([proposer("r", 0, "idle", 0.1)]);
      loop.start();
      await vi.advanceTimersByTimeAsync(550);
      expect(logs).toHaveLength(1);
      world.danger = 1;
      await vi.advanceTimersByTimeAsync(150);
      expect(logs.map((l) => l.state.data.danger)).toEqual([0, 1]);
      await loop.stop();
    });

    it("keeps at least 150 ms between ticks", async () => {
      const { loop, logs, world } = earlySetup([proposer("r", 0, "idle", 0.1)]);
      loop.start();
      await vi.advanceTimersByTimeAsync(500);
      world.danger = 1;
      await vi.advanceTimersByTimeAsync(100);
      expect(logs).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(100);
      expect(logs).toHaveLength(2);
      await loop.stop();
    });

    it("never starts a second tick while one is in flight", async () => {
      const { loop, logs, world } = earlySetup([proposer("r", 0, "idle", 0.1, 400)]);
      loop.start();
      await vi.advanceTimersByTimeAsync(500);
      world.danger = 1;
      await vi.advanceTimersByTimeAsync(300);
      expect(logs).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(200);
      expect(logs).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(400);
      expect(logs.map((l) => l.state.data.danger)).toEqual([0, 1]);
      await loop.stop();
    });
  });
});
