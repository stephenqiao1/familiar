import type { State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { describe, expect, it } from "vitest";
import { createMap } from "./map.js";
import { createMemory, type MemoryEvent, type Place } from "./memory.js";
import { createMemoryRegion, type MemoryTrigger } from "./memory-region.js";
import { createPlaceKeeper, UNFAMILIAR_SIGNAL } from "./place.js";
import { createTrail } from "./trail.js";

const at = (x: number): Place => ({ x, y: 64, z: 0, dimension: "overworld" });
const event = (over: Partial<MemoryEvent> = {}): MemoryEvent => ({ kind: "danger", place: at(0), summary: "Got hurt", involved: ["zombie"], outcome: { feeling: "bad", value: -0.5 }, ...over });
const MIN = 60_000;

describe("the order of events", () => {
  it("links a memory to the one before it when they are under two minutes apart", () => {
    const memory = createMemory({ order: 1 });
    const first = memory.record(event({ kind: "discovery", involved: ["cave"], outcome: { feeling: "neutral", value: 0 } }), 0)!.memory;
    const second = memory.record(event(), MIN)!.memory;
    const third = memory.record(event({ place: at(200) }), 4 * MIN)!.memory;
    expect(first.previous).toBeUndefined();
    expect(second.previous).toBe(first.id);
    expect(third.previous).toBeUndefined();
  });

  it("keeps two memories apart when the outcome has a different sign, and merges them when it has the same", () => {
    const memory = createMemory({ order: 1 });
    memory.record(event({ kind: "social", involved: ["player"], outcome: { feeling: "good", value: 0.5 } }), 0);
    const bad = memory.record(event({ kind: "social", involved: ["player"], outcome: { feeling: "bad", value: -0.5 } }), 1000);
    expect(bad!.merged).toBe(false);
    const again = memory.record(event({ kind: "social", involved: ["player"], outcome: { feeling: "bad", value: -0.2 } }), 2000);
    expect(again!.merged).toBe(true);
    expect(memory.consolidate("merge", 3000)).toBe(0);
    expect(memory.entries().memories).toHaveLength(2);
  });

  it("builds a 'leads to' fact when one kind of event has followed another three times", () => {
    const memory = createMemory({ order: 1 });
    for (let i = 0; i < 3; i++) {
      memory.record(event({ kind: "discovery", involved: ["hiss"], place: at(i * 100), outcome: { feeling: "neutral", value: 0 } }), i * 10 * MIN);
      memory.record(event({ involved: ["explosion"], place: at(i * 100) }), i * 10 * MIN + 2000);
      if (i === 1) expect(memory.consolidate("sequence", i * 10 * MIN + 3000)).toBe(0);
    }
    expect(memory.consolidate("sequence", 40 * MIN)).toBe(1);
    const fact = memory.facts({ limit: 5 }).find((f) => f.after !== undefined);
    expect(fact).toMatchObject({ involved: "hiss", feeling: "bad", support: 3, text: "hiss (discovery) is often followed by explosion (danger)" });
    // The plain generalising pass leaves it alone, and does not mistake it for its own.
    memory.consolidate("generalise", 40 * MIN);
    expect(memory.facts({ limit: 9 }).filter((f) => f.after !== undefined)).toHaveLength(1);
  });

  it("with the order off, behaves as before: no links, opposite outcomes merge, no 'leads to' facts", () => {
    const memory = createMemory();
    memory.record(event({ kind: "social", involved: ["player"], outcome: { feeling: "good", value: 0.5 } }), 0);
    const bad = memory.record(event({ kind: "social", involved: ["player"], outcome: { feeling: "bad", value: -0.5 } }), 1000);
    expect(bad!.merged).toBe(true);
    const next = memory.record(event(), 2000)!.memory;
    expect(next.previous).toBeUndefined();
    expect(memory.consolidate("sequence", 3000)).toBe(0);
  });
});

describe("the hippocampus region with a map", () => {
  const signal = new AbortController().signal;
  const state = (seconds: number, x: number, hurt = 0): State => ({ schemaVersion: 1, tick: seconds, timestamp: seconds * 1000, data: { x, hurt } });
  const hurt: MemoryTrigger = { name: "hurt", check: ({ after }) => ((after.data.hurt as number) > 0 ? { kind: "danger", summary: "Got hurt", involved: ["zombie"], outcome: { feeling: "bad", value: -(after.data.hurt as number) } } : null) };
  /** Dying moves the bot: the tick that sees the death already finds it somewhere else. */
  const died: MemoryTrigger = { name: "died", check: ({ after }) => (after.data.hurt === -1 ? { atPlaceBefore: true, kind: "death", summary: "Died", involved: [], outcome: { feeling: "bad", value: -1 } } : null) };
  function setup(replay = 1, resting = false) {
    const map = createMap();
    const store = createWorkspace();
    const cellOf = (s: State) => ({ key: `w:${Math.floor((s.data.x as number) / 8)}`, spot: { x: s.data.x as number, y: 64, z: 0 }, setting: "open", seen: {} });
    const place = createPlaceKeeper({ map, trail: createTrail(), cellOf, replay });
    const region = createMemoryRegion({ memory: createMemory({ order: 1 }), triggers: [died, hurt], placeOf: (s) => at(s.data.x as number), place, order: 1, resting: () => resting });
    const tick = async (seconds: number, x: number, isHurt = 0) => {
      store.update(state(seconds, x, isHurt), null);
      return (await region.run(store.viewFor("hippocampus"), signal)).trace!;
    };
    return { map, store, tick };
  }

  it("shares the place and how unfamiliar it is", async () => {
    const { store, tick } = setup();
    await tick(0, 0);
    expect(store.place()).toMatchObject({ cell: "w:0", familiarity: expect.any(Number) });
    const first = store.signals()[UNFAMILIAR_SIGNAL]!.value;
    expect(first).toBeGreaterThan(0.8);
    for (let s = 1; s < 300; s++) await tick(s, 0);
    expect(store.signals()[UNFAMILIAR_SIGNAL]!.value).toBeLessThan(first);
  });

  it("after a harm, marks the cells on the way there, and pays nothing", async () => {
    const { map, store, tick } = setup();
    for (let s = 0; s < 4; s++) await tick(s, s * 8);
    const trace = await tick(4, 24, 0.5);
    expect(trace.replays).toMatchObject([{ sign: "harm", cells: [{ cell: "w:3", amount: 0.5 }, { cell: "w:2" }, { cell: "w:1" }, { cell: "w:0" }] }]);
    expect(map.cell("w:3")!.led!.harm).toBeGreaterThan(map.cell("w:1")!.led!.harm);
    expect(Object.keys(store.signals())).toEqual([UNFAMILIAR_SIGNAL]);
  });

  it("a death is marked where the bot died, not where it woke up", async () => {
    const { map, tick } = setup();
    for (let s = 0; s < 4; s++) await tick(s, s * 8);
    const trace = await tick(4, 800, -1);
    expect(trace.replays).toMatchObject([{ sign: "harm", cells: [{ cell: "w:3", amount: 1 }, { cell: "w:2" }, { cell: "w:1" }, { cell: "w:0" }] }]);
    expect(map.cell("w:100")!.led).toBeUndefined();
  });

  it("with replay at 0 marks nothing", async () => {
    const { map, tick } = setup(0);
    await tick(0, 0);
    await tick(1, 8, 0.5);
    expect(map.cells().every((c) => c.led === undefined)).toBe(true);
  });

  it("at rest goes over the day's ways and builds 'leads to' facts, one step a tick", async () => {
    const { map, tick } = setup(1, true);
    const phases: unknown[] = [];
    for (let s = 0; s < 5; s++) phases.push(((await tick(s, s * 8)).consolidation as { phase: string }).phase);
    expect(phases).toEqual(["prune", "merge", "generalise", "sequence", "replay"]);
    expect(map.links().some((l) => l.rehearsed > 0)).toBe(true);
  });

  it("with no map and the order off, consolidates in the three phases it always had", async () => {
    const store = createWorkspace();
    const region = createMemoryRegion({ memory: createMemory(), triggers: [], placeOf: () => at(0), resting: () => true });
    const phases: unknown[] = [];
    for (let s = 0; s < 4; s++) {
      store.update(state(s * 61, 0), null);
      phases.push(((await region.run(store.viewFor("hippocampus"), signal)).trace!.consolidation as { phase: string } | undefined)?.phase);
    }
    expect(phases.slice(0, 3)).toEqual(["prune", "merge", "generalise"]);
    expect(store.place()).toBeNull();
    expect(store.signals()).toEqual({});
  });
});
