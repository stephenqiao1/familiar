import type { State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { describe, expect, it } from "vitest";
import { DEFAULT_THALAMUS, THALAMUS_OFF, thalamusProblem } from "./settings.js";
import { createThalamusRegion, type ThalamusOptions } from "./thalamus-region.js";

const signal = new AbortController().signal;
/** A made-up state: a list of things, each seen or not. */
const state = (things: { id: string; seen?: boolean }[], timestamp = 0): State => ({ schemaVersion: 1, tick: 0, timestamp, data: { things } });
const thingsOf = (s: State) => (s.data.things as { id: string }[]).map((t) => t.id);
const trim: ThalamusOptions["trim"] = (s, count) => ({ ...s, data: { things: (s.data.things as unknown[]).slice(0, count) } });
const inView: ThalamusOptions["inView"] = (s) => ({ ...s, data: { things: (s.data.things as { seen?: boolean }[]).filter((t) => t.seen !== false) } });
const crowd = [{ id: "a" }, { id: "b", seen: false }, { id: "c" }, { id: "d" }];

function thalamus(over: Partial<ThalamusOptions> = {}) {
  const store = createWorkspace();
  const region = createThalamusRegion({ readers: ["instinct", "prefrontal"], settings: THALAMUS_OFF, trim, inView, ...over });
  const tick = (s: State) => {
    store.update(s, null);
    return region.run(store.viewFor("thalamus"), signal) as { trace: Record<string, any> };
  };
  return { store, tick, view: (reader: string) => store.viewFor(reader).view(reader) };
}

describe("the workspace's views", () => {
  it("with no thalamus every reader is shown the full state", () => {
    const store = createWorkspace();
    const full = state(crowd);
    store.update(full, null);
    expect(store.viewFor("instinct").view("instinct")).toBe(full);
    expect(store.viewFor("prefrontal").view("prefrontal")).toBe(full);
  });

  it("a stored view is what that reader is shown; taking it away shows the full state again", () => {
    const store = createWorkspace();
    const [full, part] = [state(crowd), state([{ id: "a" }])];
    store.update(full, null);
    store.viewFor("thalamus").setView("instinct", part);
    expect(store.viewFor("instinct").view("instinct")).toBe(part);
    expect(store.viewFor("prefrontal").view("prefrontal")).toBe(full);
    expect(store.viewFor("instinct").state).toBe(full);
    store.viewFor("thalamus").setView("instinct", null);
    expect(store.viewFor("instinct").view("instinct")).toBe(full);
  });
});

describe("createThalamusRegion", () => {
  it("runs every tick on the fastest layer and proposes nothing", () => {
    const { tick } = thalamus();
    expect(createThalamusRegion({ readers: [], settings: THALAMUS_OFF })).toMatchObject({ name: "thalamus", layer: 0, everyMs: 0 });
    expect(tick(state(crowd))).toMatchObject({ proposals: [] });
  });

  it("with nothing to cut, each reader's view is the full state itself", () => {
    const { tick, view } = thalamus({ trim: (s) => s });
    const full = state(crowd);
    tick(full);
    expect(view("instinct")).toBe(full);
    expect(view("prefrontal")).toBe(full);
  });

  it("cuts each view to the nearest few (the attention budget); the brain's own state is untouched", () => {
    const { store, tick, view } = thalamus({ nearby: () => 2 });
    const full = state(crowd);
    const out = tick(full);
    expect(thingsOf(view("instinct"))).toEqual(["a", "b"]);
    expect(thingsOf(view("prefrontal"))).toEqual(["a", "b"]);
    expect(thingsOf(store.viewFor("reflex").state)).toEqual(["a", "b", "c", "d"]);
    expect(out.trace).toMatchObject({ nearby: 2, views: { instinct: { size: JSON.stringify(view("instinct")).length } } });
    expect(out.trace.fullSize).toBe(JSON.stringify(full).length);
  });

  it("with the field of view on, the count is cut first and then only what is in view is left", () => {
    const { tick, view } = thalamus({ nearby: () => 3, settings: { ...THALAMUS_OFF, fieldOfView: 1 } });
    tick(state(crowd));
    expect(thingsOf(view("instinct"))).toEqual(["a", "c"]);
    // Off: what is out of view is told too.
    const off = thalamus({ nearby: () => 3 });
    off.tick(state(crowd));
    expect(thingsOf(off.view("instinct"))).toEqual(["a", "b", "c"]);
  });

  it("only its readers get a view; anyone else who asks is shown the full state", () => {
    const { tick, view } = thalamus({ nearby: () => 1 });
    const full = state(crowd);
    tick(full);
    expect(view("dopamine")).toBe(full);
  });

  it("a view only selects: every thing in it is one of the state's own, unchanged", () => {
    const { tick, view } = thalamus({ nearby: () => 3, settings: { ...THALAMUS_OFF, fieldOfView: 1 } });
    const full = state(crowd);
    tick(full);
    for (const thing of view("instinct").data.things as object[]) expect(full.data.things as object[]).toContain(thing);
  });

  it("the same state gives the same view twice", () => {
    const a = thalamus({ nearby: () => 2, settings: { ...THALAMUS_OFF, fieldOfView: 1 } });
    const b = thalamus({ nearby: () => 2, settings: { ...THALAMUS_OFF, fieldOfView: 1 } });
    a.tick(state(crowd));
    b.tick(state(crowd));
    expect(a.view("instinct")).toEqual(b.view("instinct"));
  });

  it("takes well under 2 ms", () => {
    const { tick } = thalamus({ nearby: () => 2 });
    const big = state(Array.from({ length: 100 }, (_, i) => ({ id: `thing ${i}` })));
    tick(big);
    const started = performance.now();
    for (let i = 0; i < 200; i++) tick(big);
    expect((performance.now() - started) / 200).toBeLessThan(2);
  });
});

describe("thalamusProblem", () => {
  it("each strength is 0 to 1", () => {
    expect(thalamusProblem(DEFAULT_THALAMUS)).toBeNull();
    expect(thalamusProblem({ ...DEFAULT_THALAMUS, fieldOfView: 2 })).toMatch(/thalamus.fieldOfView must be 0 to 1/);
  });
});
