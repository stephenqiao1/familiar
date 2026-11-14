import type { State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { describe, expect, it } from "vitest";
import { createMemory, STARTING_STRENGTH, type Place } from "./memory.js";
import { createMemoryRegion, type MemoryTrigger } from "./memory-region.js";

const signal = new AbortController().signal;
/** A state at `seconds`, standing at x, optionally hurt this tick. */
const state = (seconds: number, x = 0, hurt = false): State => ({ schemaVersion: 1, tick: seconds, timestamp: seconds * 1000, data: { x, hurt } });
const placeOf = (s: State): Place => ({ x: s.data.x as number, y: 64, z: 0, dimension: "overworld" });
const hurt: MemoryTrigger = {
  name: "hurt",
  check: ({ after }) => (after.data.hurt ? { kind: "danger", summary: "Got hurt", involved: ["zombie"], outcome: { feeling: "bad", value: -0.5 } } : null),
};

function setup(alarmed = true) {
  const memory = createMemory();
  const store = createWorkspace();
  let alarm = 0;
  const region = createMemoryRegion({ memory, triggers: [hurt], placeOf, ...(alarmed ? { alarmOf: () => alarm } : {}) });
  const tick = async (seconds: number, x = 0, isHurt = false) => {
    store.update(state(seconds, x, isHurt), null);
    return (await region.run(store.viewFor("hippocampus"), signal)).trace!;
  };
  return { memory, tick, setAlarm: (level: number) => (alarm = level) };
}

describe("createMemoryRegion", () => {
  it("records what its triggers fire on, with the place, and logs it", async () => {
    const { memory, tick } = setup();
    await tick(0);
    expect(await tick(1, 7, true)).toEqual({ recorded: [{ trigger: "hurt", summary: "Got hurt", strength: STARTING_STRENGTH, merged: false }] });
    expect(memory.entries().memories[0]).toMatchObject({ place: { x: 7 }, kind: "danger" });
    expect(await tick(2, 7)).toEqual({});
  });

  it("remembers an event recorded during high alarm more strongly than the same event while calm", async () => {
    const calm = setup();
    await calm.tick(0);
    await calm.tick(1, 0, true);
    const scared = setup();
    scared.setAlarm(0.9);
    await scared.tick(0);
    await scared.tick(1, 0, true);
    expect(calm.memory.entries().memories[0]!.strength).toBe(STARTING_STRENGTH);
    expect(scared.memory.entries().memories[0]!.strength).toBe(0.8); // capped
  });

  it("takes the peak alarm over the minute after recording, and nothing after that", async () => {
    const { memory, tick, setAlarm } = setup();
    await tick(0);
    await tick(1, 0, true);
    setAlarm(0.6);
    await tick(30);
    expect(memory.entries().memories[0]!.strength).toBe(0.6);
    setAlarm(0.2);
    await tick(45);
    expect(memory.recall({ limit: 1, touch: false }, 45_000)[0]!.strength).toBeGreaterThan(0.59);
    setAlarm(0.8);
    await tick(120);
    expect(memory.recall({ limit: 1, touch: false }, 120_000)[0]!.strength).toBeLessThan(0.61);
  });

  it("files an event that moved the bot under where it was before", async () => {
    const memory = createMemory();
    const store = createWorkspace();
    const died: MemoryTrigger = {
      name: "died",
      check: ({ after }) => (after.data.hurt ? { atPlaceBefore: true, kind: "death", summary: "Died", involved: [], outcome: { feeling: "bad", value: -1 } } : null),
    };
    const region = createMemoryRegion({ memory, triggers: [died], placeOf });
    for (const s of [state(0, 50), state(1, 0, true)]) {
      store.update(s, null);
      await region.run(store.viewFor("hippocampus"), signal);
    }
    expect(memory.entries().memories[0]).toMatchObject({ kind: "death", place: { x: 50 } });
  });

  it("leaves strengths alone when alarm tagging is off", async () => {
    const { memory, tick } = setup(false);
    await tick(0);
    await tick(1, 0, true);
    expect(memory.entries().memories[0]!.strength).toBe(STARTING_STRENGTH);
  });

  it("guardrail: warns when more than a third of remembered places are marked dangerous", async () => {
    const { memory, tick, setAlarm } = setup();
    setAlarm(0.9);
    await tick(0);
    await tick(1, 0, true);
    await tick(100, 100, true);
    for (const x of [300, 400]) {
      const { memory: m } = memory.record({ kind: "reward", place: placeOf(state(0, x)), summary: "good", involved: [], outcome: { feeling: "good", value: 1 } }, 0)!;
      memory.tag(m.id, 0.8, 0);
    }
    expect((await tick(101)).warning).toMatch(/2 of 4 remembered places are marked dangerous/);
  });
});

describe("focus and rest", () => {
  /** A region whose focus, alarm and rest are set by the test. */
  function world() {
    const memory = createMemory();
    const store = createWorkspace();
    const now = { focus: 0.5, resting: false };
    const big: MemoryTrigger = {
      name: "hurt",
      check: ({ after }) => (after.data.hurt ? { kind: "danger", summary: "Got hurt", involved: ["zombie"], outcome: { feeling: "bad", value: (after.data.value as number | undefined) ?? -0.5 } } : null),
    };
    const region = createMemoryRegion({ memory, triggers: [big], placeOf, focusOf: () => now.focus, resting: () => now.resting });
    const tick = async (seconds: number, x = 0, isHurt = false, value?: number) => {
      store.update({ ...state(seconds, x, isHurt), data: { x, hurt: isHurt, value } }, null);
      return (await region.run(store.viewFor("hippocampus"), signal)).trace!;
    };
    return { memory, now, tick };
  }

  it("stores the same event more strongly at high focus than at low focus", async () => {
    const strengthAt = async (focus: number) => {
      const { memory, now, tick } = world();
      now.focus = focus;
      await tick(0);
      await tick(1, 0, true);
      return memory.entries().memories[0]!.strength;
    };
    expect(await strengthAt(0.9)).toBeCloseTo(0.42);
    expect(await strengthAt(0.5)).toBeCloseTo(STARTING_STRENGTH);
    expect(await strengthAt(0.3)).toBeCloseTo(0.24);
  });

  it("at very low focus records only events above a high importance bar", async () => {
    const { memory, now, tick } = world();
    now.focus = 0.1;
    await tick(0);
    await tick(1, 0, true, -0.3);
    expect(memory.entries().memories).toEqual([]);
    await tick(2, 0, true, -0.8);
    expect(memory.entries().memories).toHaveLength(1);
  });

  it("consolidates only at rest: one phase per tick, then a pause before the next round", async () => {
    const { now, tick } = world();
    expect((await tick(0)).consolidation).toBeUndefined();
    now.resting = true;
    const phases = [];
    for (let s = 1; s <= 4; s++) phases.push(((await tick(s)).consolidation as { phase: string } | undefined)?.phase);
    expect(phases).toEqual(["prune", "merge", "generalise", undefined]);
    expect(((await tick(70)).consolidation as { phase: string }).phase).toBe("prune");
  });

  it("refuses to consolidate when not at rest, and stops mid-round the moment rest ends", async () => {
    const { now, tick } = world();
    now.resting = true;
    expect((await tick(1)).consolidation).toMatchObject({ phase: "prune" });
    now.resting = false; // alarm rose, or focus came back up
    expect((await tick(2)).consolidation).toBeUndefined();
    expect((await tick(3)).consolidation).toBeUndefined();
    now.resting = true;
    expect((await tick(4)).consolidation).toMatchObject({ phase: "prune" }); // a fresh round
  });

  it("writes a general fact from three matching memories while resting", async () => {
    const { memory, now, tick } = world();
    await tick(0);
    for (const [i, x] of [100, 300, 500].entries()) await tick(100 * (i + 1), x, true);
    now.resting = true;
    for (let s = 600; s < 603; s++) await tick(s);
    expect(memory.facts({ limit: 5 }).map((f) => f.text)).toEqual(["zombie is dangerous"]);
  });
});
