import type { State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { describe, expect, it } from "vitest";
import { createNoradrenalineRegion, type AlarmTrigger } from "./noradrenaline-region.js";
import type { SearchInput } from "./search.js";
import { DEFAULT_NORADRENALINE, type NoradrenalineSettings } from "./settings.js";

const signal = new AbortController().signal;
type World = { bump?: number; threat?: boolean; pressure?: number };
const state = (seconds: number, world: World): State => ({ schemaVersion: 1, tick: seconds, timestamp: seconds * 1000, data: { ...world } });
/** Adds whatever the state says to add. */
const hit: AlarmTrigger = { name: "hit", check: ({ after }) => (after.data.bump as number | undefined) ?? 0 };
const pressure: SearchInput = { name: "pressure", read: (ws) => (ws.state.data.pressure as number | undefined) ?? 0 };
const OFF: NoradrenalineSettings = { ...DEFAULT_NORADRENALINE, inCharge: 0, interrupt: 0, focus: 0, memoryTag: 0, patienceLink: 0, switching: 0, widerOptions: 0, tellPlanner: 0 };

function setup(settings: Partial<NoradrenalineSettings> = {}) {
  const store = createWorkspace();
  const region = createNoradrenalineRegion({
    triggers: [hit],
    threatPresent: (s) => s.data.threat === true,
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

  describe("alarm", () => {
    it("rises at once on a trigger, names it in the log, and fades once the threat is gone", async () => {
      const { tick, wait, value } = setup();
      await tick();
      expect(await tick({ bump: 0.9, threat: true })).toMatchObject({ alarm: 0.9, raisedBy: { hit: 0.9 }, threat: true });
      await wait(60, { threat: true });
      expect(value("alarm")).toBe(0.9);
      await wait(120);
      expect(value("alarm")).toBeLessThan(0.1);
    });
  });

  describe("a) who is in charge", () => {
    it("lowers the planner's weight as alarm rises: 1 − alarm²", async () => {
      const { tick, value } = setup();
      await tick();
      expect(value("planner_weight")).toBe(1);
      await tick({ bump: 0.5, threat: true });
      expect(value("planner_weight")).toBeCloseTo(0.75);
      expect(value("planner_offline")).toBe(0);
    });

    it("takes the planner offline above 0.8 until alarm is back under 0.5, then restores its weight over about 10 seconds", async () => {
      const { tick, wait, value } = setup();
      await tick();
      await tick({ bump: 0.9, threat: true });
      expect([value("planner_weight"), value("planner_offline")]).toEqual([0, 1]);
      // Alarm fades to about 0.6: under the 0.8 that tripped it, but still offline.
      await wait(12);
      expect(value("alarm")).toBeGreaterThan(0.5);
      expect(value("planner_offline")).toBe(1);
      await wait(6);
      expect(value("alarm")).toBeLessThan(0.5);
      expect(value("planner_offline")).toBe(0);
      expect(value("planner_weight")).toBeLessThan(0.2); // back online, but its weight returns slowly
      await wait(10);
      expect(value("planner_weight")).toBeGreaterThan(0.8);
    });
  });

  describe("b) interrupt and re-plan", () => {
    it("fires one interrupt on a jump of more than 0.5, clears the goal, and asks for a new plan once calm", async () => {
      const { store, tick, wait, value, setGoal } = setup();
      await tick();
      setGoal();
      expect(await tick({ bump: 0.6 })).toMatchObject({ interrupt: true });
      expect([value("interrupt"), value("alarm_jump")]).toEqual([1, 1]);
      expect(store.goal()).toBeNull();
      expect(value("replan")).toBe(0); // alarm still 0.6: not calm yet
      await tick();
      expect(value("interrupt")).toBe(0);
      await wait(8);
      expect(value("alarm")).toBeLessThan(0.5);
      expect(value("replan")).toBe(1);
      setGoal(); // the planner planned
      await tick();
      expect(value("replan")).toBe(0);
    });

    it("does not fire a second interrupt inside 20 seconds, but still reports the jump", async () => {
      const { tick, wait, value } = setup({ alarmDecaySeconds: 3 });
      await tick();
      await tick({ bump: 0.6 });
      await wait(10);
      await tick({ bump: 0.6 });
      expect([value("alarm_jump"), value("interrupt")]).toEqual([1, 0]);
      await wait(10);
      await tick({ bump: 0.6 });
      expect(value("interrupt")).toBe(1);
    });

    it("does not count a small rise as a jump", async () => {
      const { tick, value } = setup();
      await tick();
      await tick({ bump: 0.4 });
      expect([value("alarm_jump"), value("interrupt")]).toEqual([0, 0]);
    });
  });

  describe("search", () => {
    it("rises under pressure, falls with success, and logs its inputs", async () => {
      const up = setup();
      expect(await up.wait(120, { pressure: 1 })).toMatchObject({ searchInputs: { pressure: 1 } });
      expect(up.value("search")).toBeGreaterThan(0.5);
      const down = setup();
      await down.wait(120, { pressure: -1 });
      expect(down.value("search")).toBeLessThan(0.15);
    });

    it("eases switching as it rises: the switching signal follows search", async () => {
      const { wait, value } = setup();
      await wait(1);
      expect(value("search_switching")).toBeCloseTo(0.3);
      await wait(300, { pressure: 2 });
      expect(value("search_switching")).toBeCloseTo(value("search")!);
    });

    it("c) tells the planner to rethink after 30 seconds above 0.7, then not again for 2 minutes", async () => {
      const { tick, wait, value, setGoal } = setup();
      setGoal();
      let trace = await wait(1);
      let seconds = 0;
      while (value("rethink") !== 1 && seconds++ < 400) trace = await tick({ pressure: 2 });
      expect(trace.rethink).toMatch(/isn't paying off/);
      expect([value("rethink"), value("replan")]).toEqual([1, 1]);
      await new Promise((resolve) => setTimeout(resolve, 5)); // so the new goal's time differs
      setGoal(); // the planner planned again
      await tick({ pressure: 2 });
      expect([value("rethink"), value("replan")]).toEqual([0, 0]);
      await wait(60, { pressure: 2 });
      expect(value("rethink")).toBe(0);
      await wait(70, { pressure: 2 });
      expect(value("rethink")).toBe(1);
    });
  });

  describe("guardrails", () => {
    it("panic lock: after a minute above 0.8, forces a retreat goal once", async () => {
      const { store, tick, wait } = setup();
      await tick();
      await tick({ bump: 1, threat: true });
      const quiet = await wait(60, { threat: true });
      expect(quiet.panicLock).toBeUndefined();
      expect((await tick({ threat: true })).panicLock).toMatch(/retreat/);
      expect(store.goal()).toMatchObject({ text: expect.stringMatching(/^Retreat to safety/), setBy: "noradrenaline" });
      expect((await tick({ threat: true })).panicLock).toBeUndefined();
    });

    it("jumpiness: after more than 5 interrupts in 5 minutes, needs a bigger jump for the next 5", async () => {
      const { tick, wait, value } = setup({ alarmDecaySeconds: 3 });
      await tick();
      let trace: Record<string, unknown> = {};
      for (let i = 0; i < 6; i++) {
        trace = await tick({ bump: 0.6 });
        await wait(21);
      }
      expect(trace.jumpy).toMatch(/6 interrupts in 5 minutes/);
      await tick({ bump: 0.6 }); // a jump of 0.6 no longer counts
      expect([value("alarm_jump"), value("interrupt")]).toEqual([0, 0]);
      await wait(21);
      await tick({ bump: 0.8 });
      expect(value("interrupt")).toBe(1);
    });

    it("goal-hopping: after more than 4 switches with search high, halves its effect on switching", async () => {
      const { store, tick, wait, value } = setup();
      await wait(300, { pressure: 2 });
      for (let i = 0; i < 5; i++) store.addEvent({ skill: "go_to", type: "interrupted", timestamp: i });
      expect((await tick({ pressure: 2 })).goalHopping).toMatch(/halving/);
      const search = value("search")!;
      expect(value("search_switching")).toBeCloseTo(0.3 + (search - 0.3) / 2);
    });
  });

  it("with every effect off, the dials still move but nothing else changes", async () => {
    const { store, tick, wait, value, setGoal } = setup(OFF);
    await tick();
    setGoal();
    await tick({ bump: 1, threat: true });
    await wait(300, { threat: true, pressure: 2 });
    expect(value("alarm")).toBe(1);
    expect(value("search")).toBeGreaterThan(0.9);
    expect([value("planner_weight"), value("planner_offline"), value("interrupt"), value("replan"), value("rethink")]).toEqual([1, 0, 0, 0, 0]);
    expect(value("search_switching")).toBeCloseTo(0.3);
    // The panic lock is a guardrail, not an effect: it still sets a retreat goal.
    expect(store.goal()?.setBy).toBe("noradrenaline");
  });
});
