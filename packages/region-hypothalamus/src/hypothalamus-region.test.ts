import type { State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { describe, expect, it } from "vitest";
import { createHypothalamusRegion } from "./hypothalamus-region.js";
import type { Need } from "./need.js";
import { readNeeds } from "./read.js";

const signal = new AbortController().signal;
const state = (data: Record<string, unknown>): State => ({ schemaVersion: 1, tick: 0, timestamp: 0, data });
const from = (name: string, more: Partial<Need> = {}): Need => ({ name, kind: "body", level: (s) => (s.data[name] as number | undefined) ?? null, ...more });
const needs = [from("hunger"), from("danger", { rank: 1 })];

describe("createHypothalamusRegion", () => {
  it("runs every tick on the fastest layer and never proposes", async () => {
    const region = createHypothalamusRegion({ needs });
    expect(region).toMatchObject({ name: "hypothalamus", layer: 0, everyMs: 0 });
    expect((await region.run(createWorkspace().viewFor("hypothalamus"), signal)).proposals).toEqual([]);
  });

  it("shares this tick's reading as the workspace's needs, and logs each level and how hard it presses", async () => {
    const store = createWorkspace();
    expect(store.viewFor("dopamine").needs).toBeNull(); // with no hypothalamus there is no shared reading
    store.update(state({ hunger: 0.5, danger: 0.25 }), null);
    const out = await createHypothalamusRegion({ needs }).run(store.viewFor("hypothalamus"), signal);
    expect(store.viewFor("dopamine").needs).toMatchObject({ readings: readNeeds(needs, store.viewFor("dopamine").state) });
    expect(out.trace).toMatchObject({ needs: { hunger: { level: 0.5, pressing: 0 }, danger: { level: 0.25, pressing: 0.25 } } });
  });

  it("reads again each tick", async () => {
    const store = createWorkspace();
    const region = createHypothalamusRegion({ needs });
    store.update(state({ hunger: 0.5 }), null);
    await region.run(store.viewFor("hypothalamus"), signal);
    store.update(state({ hunger: 0.75 }), null);
    await region.run(store.viewFor("hypothalamus"), signal);
    expect(store.needs()?.readings).toMatchObject([{ name: "hunger", level: 0.75 }]);
  });

  it("a reader cannot change the shared reading for the others", async () => {
    const store = createWorkspace();
    store.update(state({ hunger: 0.5 }), null);
    const view = store.viewFor("hypothalamus");
    const readings = readNeeds(needs, view.state);
    view.setNeeds({ readings });
    readings[0]!.level = 0;
    expect(store.needs()?.readings[0]!.level).toBe(0.5);
  });
});
