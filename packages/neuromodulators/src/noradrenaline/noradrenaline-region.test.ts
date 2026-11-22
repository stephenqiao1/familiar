import type { State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { describe, expect, it } from "vitest";
import { createNoradrenalineRegion } from "./noradrenaline-region.js";
import type { SearchInput } from "./search.js";
import { DEFAULT_NORADRENALINE, type NoradrenalineSettings } from "./settings.js";

const signal = new AbortController().signal;
/** `danger` is a vital need (rank 1), `hunger` an ordinary one; `startle` is the body's; `pressure` moves search. */
type World = { danger?: number; hunger?: number; startle?: number; pressure?: number };
const state = (seconds: number, world: World): State => ({ schemaVersion: 1, tick: seconds, timestamp: seconds * 1000, data: { ...world } });
const read = (s: State, name: keyof World) => (s.data[name] as number | undefined) ?? 0;
const pressure: SearchInput = { name: "pressure", read: (ws) => read(ws.state, "pressure") };
const OFF: NoradrenalineSettings = { ...DEFAULT_NORADRENALINE, inCharge: 0, interrupt: 0, focus: 0, memoryTag: 0, switching: 0, widerOptions: 0, tellPlanner: 0 };

function setup(settings: Partial<NoradrenalineSettings> = {}) {
  const store = createWorkspace();
  const region = createNoradrenalineRegion({
    needs: (ws) => [
      { name: "danger", level: read(ws.state, "danger"), rank: 1, weight: 1 },
      { name: "hunger", level: read(ws.state, "hunger"), rank: 0, weight: 1 },
    ],
    startle: (ws) => read(ws.state, "startle"),
    settings: { ...DEFAULT_NORADRENALINE, ...settings },
    searchInputs: [pressure],
  });
  let seconds = 0;
  /** Runs one tick at the current second, then moves on by `step` seconds. */
  const tick = async (world: World = {}, step = 1) => {
    store.update(state(seconds, world), null);
    seconds += step;
    return (await region.run(store.viewFor("noradrenaline"), signal)).trace!;
  };
  /** Ticks once a second for `forSeconds`. */
  const wait = async (forSeconds: number, world: World = {}) => {
    let trace = {};
    for (let i = 0; i < forSeconds; i++) trace = await tick(world);
    return trace as Record<string, unknown>;
  };
  const value = (name: string) => store.signals()[name]?.value;
  const setGoal = () => store.viewFor("prefrontal").setGoal({ text: "build", steps: [], reason: "" });
  return { store, region, tick, wait, value, setGoal };
}

describe("createNoradrenalineRegion", () => {
  it("runs every tick on the fastest layer and never proposes", async () => {
    const { region, store } = setup();
    expect(region).toMatchObject({ name: "noradrenaline", layer: 0, everyMs: 0 });
    expect((await region.run(store.viewFor("noradrenaline"), signal)).proposals).toEqual([]);
  });

  describe("alarm follows the needs", () => {
    it("is never below what a vital need presses at, stays there while it does, and goes within seconds once it stops", async () => {
      const { tick, wait, value } = setup();
      await tick();
      expect(await tick({ danger: 0.9 })).toMatchObject({ alarm: 0.9, sustained: 0.9, raisedBy: { danger: 0.9 } });
      await wait(60, { danger: 0.9 });
      expect(value("alarm")).toBe(0.9);
      await wait(10);
      expect(value("alarm")).toBeLessThan(0.2);
      await wait(15);
      expect(value("alarm")).toBeLessThan(0.02);
    });

    it("comes down as the danger does, not by a clock", async () => {
      const { tick, wait, value } = setup();
      await tick();
      await wait(5, { danger: 0.9 });
      await wait(20, { danger: 0.3 });
      expect(value("alarm")).toBeCloseTo(0.3);
    });

    it("an ordinary need pressing is not alarm, but one suddenly much worse adds a jump that fades", async () => {
      const { tick, wait, value } = setup();
      await tick();
      // Slowly hungrier: nothing.
      for (let h = 0.1; h <= 1; h += 0.1) await tick({ hunger: h });
      expect(value("alarm")).toBeLessThan(0.15);
      await wait(30, { hunger: 1 });
      expect(value("alarm")).toBeLessThan(0.01);
      // A third of it gone in one tick (a blow): a jump, soon over.
      const gentle = setup();
      await gentle.tick();
      expect(await gentle.tick({ hunger: 0.33 })).toMatchObject({ alarm: 0.33, sustained: 0, raisedBy: { hunger: 0.33 } });
      await gentle.wait(20, { hunger: 0.33 });
      expect(gentle.value("alarm")).toBeLessThan(0.02);
    });

    it("a startle raises it by 0.4 times its size; with a need worse on the same tick the larger counts, not the sum", async () => {
      const { tick } = setup();
      await tick();
      expect(await tick({ startle: 1 })).toMatchObject({ alarm: 0.4, raisedBy: { startle: 0.4 } });
      const both = setup();
      await both.tick();
      expect((await both.tick({ startle: 1, danger: 0.7 })).alarm).toBeCloseTo(0.7);
    });

    it("a jumpy bot takes a sudden worsening harder, a steady one less", async () => {
      const jumpy = setup({ alarmGain: 1.5 });
      await jumpy.tick();
      expect((await jumpy.tick({ hunger: 0.4 })).alarm).toBeCloseTo(0.6);
      const steady = setup({ alarmGain: 0.5 });
      await steady.tick();
      expect((await steady.tick({ hunger: 0.4 })).alarm).toBeCloseTo(0.2);
    });
  });

  describe("a) who is in charge", () => {
    it("lowers the planner's weight as alarm rises: 1 − alarm²", async () => {
      const { tick, value } = setup();
      await tick();
      expect(value("planner_weight")).toBe(1);
      await tick({ danger: 0.5 });
      expect(value("planner_weight")).toBeCloseTo(0.75);
      expect(value("planner_offline")).toBe(0);
    });

    it("takes the planner offline above 0.8 until alarm is back under 0.5, then restores its weight over about 10 seconds", async () => {
      const { tick, wait, value } = setup();
      await tick();
      await tick({ danger: 0.9 });
      expect([value("planner_weight"), value("planner_offline")]).toEqual([0, 1]);
      // The danger eases to 0.6: under the 0.8 that tripped it, but still offline.
      await wait(5, { danger: 0.6 });
      expect(value("planner_offline")).toBe(1);
      await wait(5);
      expect(value("alarm")).toBeLessThan(0.5);
      expect(value("planner_offline")).toBe(0);
      expect(value("planner_weight")).toBeLessThan(0.6); // back online, but its weight returns slowly
      await wait(10);
      expect(value("planner_weight")).toBeGreaterThan(0.8);
    });
  });

  describe("b) interrupt", () => {
    it("fires one interrupt on a jump of more than 0.5, and keeps the goal", async () => {
      const { store, tick, value, setGoal } = setup();
      await tick();
      setGoal();
      expect(await tick({ danger: 0.6 })).toMatchObject({ interrupt: true });
      expect([value("interrupt"), value("alarm_jump")]).toEqual([1, 1]);
      expect(store.goal()?.text).toBe("build");
      expect(value("replan")).toBe(0); // nothing about the goal changed: the planner is not asked again
      await tick();
      expect(value("interrupt")).toBe(0);
    });

    it("does not fire a second interrupt inside 20 seconds, but still reports the jump", async () => {
      const { tick, wait, value } = setup();
      await tick();
      await tick({ danger: 0.6 });
      await wait(10);
      await tick({ danger: 0.6 });
      expect([value("alarm_jump"), value("interrupt")]).toEqual([1, 0]);
      await wait(10);
      await tick({ danger: 0.6 });
      expect(value("interrupt")).toBe(1);
    });

    it("does not count a small rise, or a slow one, as a jump", async () => {
      const { tick, value } = setup();
      await tick();
      await tick({ danger: 0.4 });
      expect([value("alarm_jump"), value("interrupt")]).toEqual([0, 0]);
      // A threat walking up: alarm climbs to 0.9 over ten seconds with no jump in it.
      const slow = setup();
      await slow.tick();
      for (let d = 0.1; d <= 0.95; d += 0.1) await slow.tick({ danger: d });
      expect(slow.value("alarm")).toBeGreaterThan(0.85);
      expect(slow.value("interrupt")).toBe(0);
    });
  });

  describe("search", () => {
    it("rises under pressure all the way to its effects' levels, falls with success, and logs its inputs", async () => {
      const up = setup();
      expect(await up.wait(120, { pressure: 1 })).toMatchObject({ searchInputs: { pressure: 1 } });
      expect(up.value("search")).toBeGreaterThan(0.8);
      const half = setup();
      await half.wait(300, { pressure: 0.5 });
      expect(half.value("search")).toBeCloseTo(0.65, 1);
      const down = setup();
      await down.wait(120, { pressure: -1 });
      expect(down.value("search")).toBeLessThan(0.1);
    });

    it("eases switching as it rises: the switching signal follows search", async () => {
      const { wait, value } = setup();
      await wait(1);
      expect(value("search_switching")).toBeCloseTo(0.3);
      await wait(300, { pressure: 1 });
      expect(value("search_switching")).toBeCloseTo(value("search")!);
    });

    it("c) tells the planner to rethink after 30 seconds above 0.7, then not again for 2 minutes", async () => {
      const { tick, wait, value, setGoal } = setup();
      setGoal();
      let trace = await wait(1);
      let seconds = 0;
      while (value("rethink") !== 1 && seconds++ < 400) trace = await tick({ pressure: 1 });
      expect(trace.rethink).toMatch(/isn't paying off/);
      expect([value("rethink"), value("replan")]).toEqual([1, 1]);
      await new Promise((resolve) => setTimeout(resolve, 5)); // so the new goal's time differs
      setGoal(); // the planner planned again
      await tick({ pressure: 1 });
      expect([value("rethink"), value("replan")]).toEqual([0, 0]);
      await wait(60, { pressure: 1 });
      expect(value("rethink")).toBe(0);
      await wait(70, { pressure: 1 });
      expect(value("rethink")).toBe(1);
    });
  });

  describe("guardrails", () => {
    it("panic lock: after a minute above 0.8, forces a retreat goal once", async () => {
      const { store, tick, wait } = setup();
      await tick();
      await tick({ danger: 1 });
      const quiet = await wait(60, { danger: 1 });
      expect(quiet.panicLock).toBeUndefined();
      expect((await tick({ danger: 1 })).panicLock).toMatch(/retreat/);
      expect(store.goal()).toMatchObject({ text: expect.stringMatching(/^Retreat to safety/), setBy: "noradrenaline" });
      expect((await tick({ danger: 1 })).panicLock).toBeUndefined();
    });

    it("jumpiness: after more than 5 interrupts in 5 minutes, needs a bigger jump for the next 5", async () => {
      const { tick, wait, value } = setup();
      await tick();
      let trace: Record<string, unknown> = {};
      for (let i = 0; i < 6; i++) {
        trace = await tick({ danger: 0.6 });
        await wait(21);
      }
      expect(trace.jumpy).toMatch(/6 interrupts in 5 minutes/);
      await tick({ danger: 0.6 }); // a jump of 0.6 no longer counts
      expect([value("alarm_jump"), value("interrupt")]).toEqual([0, 0]);
      await wait(21);
      await tick({ danger: 0.8 });
      expect(value("interrupt")).toBe(1);
    });
  });

  it("with every effect off, the dials still move but nothing else changes", async () => {
    const { store, tick, wait, value, setGoal } = setup(OFF);
    await tick();
    setGoal();
    await wait(300, { danger: 1, pressure: 1 });
    expect(value("alarm")).toBe(1);
    expect(value("search")).toBeGreaterThan(0.9);
    expect([value("planner_weight"), value("planner_offline"), value("interrupt"), value("replan"), value("rethink")]).toEqual([1, 0, 0, 0, 0]);
    expect(value("search_switching")).toBeCloseTo(0.3);
    // The panic lock is a guardrail, not an effect: it still sets a retreat goal.
    expect(store.goal()?.setBy).toBe("noradrenaline");
  });
});
