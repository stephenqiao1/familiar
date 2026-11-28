import type { State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { describe, expect, it } from "vitest";
import { createCerebellumRegion, SETTLED_RATE_BOUNDS } from "./cerebellum-region.js";
import { MISMATCH_SIGNAL } from "./mismatch.js";
import { createModels, modelId, type Movement } from "./model.js";
import { DEFAULT_CEREBELLUM } from "./settings.js";

const state = (timestamp: number): State => ({ schemaVersion: 1, tick: 0, timestamp, data: {} });
type Trace = { runs?: { measures: { predicted: number | null; error: number | null; from: string | null }[]; missing?: string[]; expected?: string[] }[] } | undefined;
function setup() {
  const store = createModels();
  let pending: Movement[] = [];
  const region = createCerebellumRegion({ store, movements: () => pending.splice(0) });
  const ws = createWorkspace();
  const view = ws.viewFor("cerebellum");
  const tick = (now: number, ...movements: Movement[]) => {
    pending = movements;
    ws.update(state(now), null);
    return (region.run(view, new AbortController().signal) as { trace?: Trace }).trace;
  };
  return { store, tick, view };
}
const dig = (seconds: number, at: number, extra: Partial<Movement> = {}): Movement => ({ kind: "primitive", name: "break_block", keys: ["stone|wooden_pickaxe", "stone", ""], measures: { seconds }, changes: ["targetBlock=air", "drops"], at, ...extra });

describe("the cerebellum region", () => {
  it("learns each key from specific to general, and traces the signed error once trusted", async () => {
    const { store, tick } = setup();
    for (let i = 0; i < 5; i++) expect((await tick(i * 1000, dig(2, i * 1000)))?.runs?.[0]?.measures[0]?.predicted).toBeNull();
    expect(store.get(modelId("primitive", "break_block", "stone"))?.measures.seconds?.value).toBe(2);
    const trace = await tick(6000, dig(3, 6000));
    expect(trace?.runs?.[0]?.measures[0]).toMatchObject({ predicted: 2, error: 1, from: "stone|wooden_pickaxe" });
    expect(trace?.runs?.[0]?.expected).toEqual(["drops", "targetBlock=air"]);
  });

  it("a run that was cut short teaches nothing", async () => {
    const { store, tick } = setup();
    for (let i = 0; i < 5; i++) await tick(i * 1000, dig(2, i * 1000));
    const before = JSON.stringify(store.entries());
    await tick(6000, dig(0.3, 6000, { cutShort: true, changes: [] }));
    expect(JSON.stringify(store.entries())).toBe(before);
  });

  it("says which nearly certain change did not follow", async () => {
    const { tick } = setup();
    for (let i = 0; i < 6; i++) await tick(i * 1000, dig(2, i * 1000));
    expect((await tick(7000, dig(2, 7000, { changes: [] })))?.runs?.[0]?.missing).toEqual(["drops", "targetBlock=air"]);
  });

  it("shares no signal while movements come out as predicted, and proposes nothing", async () => {
    const { tick, view } = setup();
    for (let i = 0; i < 8; i++) await tick(i * 1000, dig(2, i * 1000));
    expect(Object.keys(view.signals)).toEqual([]);
  });

  it("raises mismatch by how many spreads off a movement was, and lets it fade within a second", async () => {
    const { tick, view } = setup();
    for (let i = 0; i < 6; i++) await tick(i * 1000, dig(2, i * 1000));
    // One spread is a tenth of the value at least (0.2 s): 0.2 s off is nothing, 0.6 s is large, 1.2 s is full.
    await tick(7000, dig(2.2, 7000));
    expect(view.signals[MISMATCH_SIGNAL]?.value ?? 0).toBe(0);
    await tick(8000, dig(2.7, 8000));
    const large = view.signals[MISMATCH_SIGNAL]!.value;
    expect(large).toBeGreaterThanOrEqual(0.4);
    expect(large).toBeLessThan(1);
    await tick(8500);
    expect(view.signals[MISMATCH_SIGNAL]!.value).toBeCloseTo(large / 2, 2);
    await tick(9100);
    expect(view.signals[MISMATCH_SIGNAL]!.value).toBe(0);
    // Much faster than predicted is a mismatch too (a new tool).
    await tick(10_000, dig(0.5, 10_000));
    expect(view.signals[MISMATCH_SIGNAL]!.value).toBe(1);
  });

  it("raises a modest mismatch when a change that always followed does not, and none for a run cut short or a general guess", async () => {
    const { tick, view } = setup();
    for (let i = 0; i < 6; i++) await tick(i * 1000, dig(2, i * 1000));
    await tick(7000, dig(2, 7000, { changes: [], cutShort: true }));
    expect(view.signals[MISMATCH_SIGNAL]?.value ?? 0).toBe(0);
    // A block never dug before: only the any-situation model speaks, and that is no mismatch.
    await tick(8000, dig(9, 8000, { keys: ["obsidian|wooden_pickaxe", "obsidian", ""], changes: [] }));
    expect(view.signals[MISMATCH_SIGNAL]?.value ?? 0).toBe(0);
    // One miss is weak evidence: a mismatch, but never a large one.
    await tick(20_000, dig(2, 20_000, { changes: [] }));
    expect(view.signals[MISMATCH_SIGNAL]!.value).toBeGreaterThan(0.3);
    expect(view.signals[MISMATCH_SIGNAL]!.value).toBeLessThan(0.5);
  });

  it("raises mismatch while a movement under way is well behind its pace", async () => {
    const store = createModels();
    let behind = 0;
    const region = createCerebellumRegion({ store, movements: () => [], behind: () => behind });
    const ws = createWorkspace();
    const view = ws.viewFor("cerebellum");
    const run = (now: number) => (ws.update(state(now), null), region.run(view, new AbortController().signal));
    await run(1000);
    expect(view.signals[MISMATCH_SIGNAL]).toBeUndefined();
    behind = 3;
    await run(2000);
    expect(view.signals[MISMATCH_SIGNAL]!.value).toBe(0.5);
    behind = 0;
    await run(3000);
    expect(view.signals[MISMATCH_SIGNAL]!.value).toBe(0);
  });

  it("with mismatch at 0 it shares nothing, whatever happens", async () => {
    const store = createModels();
    let pending: Movement[] = [];
    const region = createCerebellumRegion({ store, movements: () => pending.splice(0), behind: () => 9, settings: { ...DEFAULT_CEREBELLUM, mismatch: 0 } });
    const ws = createWorkspace();
    const view = ws.viewFor("cerebellum");
    for (let i = 0; i < 8; i++) {
      pending = [dig(i < 7 ? 2 : 9, i * 1000)];
      ws.update(state(i * 1000), null);
      await region.run(view, new AbortController().signal);
    }
    expect(Object.keys(view.signals)).toEqual([]);
  });
});

describe("the settled rate follows how changeable things are", () => {
  /** A dig learned as 2 s many times over, then one that took 4: how far the estimate moved, with the rate scaled by this. */
  function movedBy(scale: number | undefined) {
    const store = createModels();
    let pending: Movement[] = [];
    const region = createCerebellumRegion({ store, movements: () => pending.splice(0), ...(scale === undefined ? {} : { rateScale: () => scale }) });
    const ws = createWorkspace();
    const tick = (now: number, movement: Movement) => {
      pending = [movement];
      ws.update(state(now), null);
      region.run(ws.viewFor("cerebellum"), new AbortController().signal);
    };
    for (let i = 0; i < 40; i++) tick(i * 1000, dig(2, i * 1000));
    tick(50_000, dig(4, 50_000));
    return store.get(modelId("primitive", "break_block", "stone"))!.measures.seconds!.value - 2;
  }

  it("a higher scale learns faster and a lower one slower, and with none it is as it was", () => {
    const usual = movedBy(undefined);
    expect(movedBy(1)).toBe(usual);
    expect(movedBy(1.5)).toBeCloseTo(usual * 1.5, 5);
    expect(movedBy(0.5)).toBeCloseTo(usual * 0.5, 5);
  });

  it("the rate stays inside its bounds whatever the scale says", () => {
    const usual = movedBy(undefined);
    // The settled rate is 0.1: it may be at most 0.5 and at least 0.02.
    expect(movedBy(100)).toBeCloseTo(usual * (SETTLED_RATE_BOUNDS.most / DEFAULT_CEREBELLUM.settledRate), 5);
    // (At the low end a model this young still learns at one over its count of runs, which is above the bound.)
    expect(movedBy(0.001)).toBeGreaterThan(usual * (SETTLED_RATE_BOUNDS.least / DEFAULT_CEREBELLUM.settledRate) - 1e-9);
    expect(movedBy(0.001)).toBeLessThan(movedBy(0.5));
  });
});
