import type { State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { describe, expect, it } from "vitest";
import { createPatienceRegion, type OutlookInput } from "./patience-region.js";
import { DEFAULT_PATIENCE } from "./settings.js";

const signal = new AbortController().signal;
const state = (seconds: number, data: Record<string, unknown> = {}): State => ({ schemaVersion: 1, tick: seconds, timestamp: seconds * 1000, data });
/** An input that reads a number from the state's data. */
const from = (name: string): OutlookInput => ({ name, read: (ws) => (ws.state.data[name] as number | undefined) ?? null });

function setup(options: Partial<Parameters<typeof createPatienceRegion>[0]> = {}) {
  const store = createWorkspace();
  const region = createPatienceRegion({ inputs: [from("safety"), from("fed")], settings: DEFAULT_PATIENCE, ...options });
  const tick = async (seconds: number, data?: Record<string, unknown>) => {
    store.update(state(seconds, data), null);
    return (await region.run(store.viewFor("serotonin"), signal)).trace!;
  };
  return { store, region, tick };
}

describe("createPatienceRegion", () => {
  it("runs every tick on the fastest layer and never proposes", async () => {
    const { region, store } = setup();
    expect(region).toMatchObject({ name: "serotonin", layer: 0, everyMs: 0 });
    expect((await region.run(store.viewFor("serotonin"), signal)).proposals).toEqual([]);
  });

  it("averages the inputs into the outlook, and shares patience and outlook as signals", async () => {
    const { store, tick } = setup();
    expect(await tick(0, { safety: 1, fed: 0.5 })).toEqual({ patience: 0.5, outlook: 0.75, inputs: { safety: 1, fed: 0.5 } });
    expect(store.signals()).toMatchObject({ patience: { value: 0.5, source: "serotonin" }, outlook: { value: 0.75 } });
  });

  it("skips inputs that are unknown, and rests when none is known", async () => {
    const { tick } = setup();
    expect(await tick(0, { fed: 0.2 })).toMatchObject({ outlook: 0.2, inputs: { fed: 0.2 } });
    expect(await tick(1)).toMatchObject({ outlook: null, inputs: {} });
  });

  it("cuts patience by 0.2 at once on a shock", async () => {
    const { tick } = setup({ isShock: (_before, after) => after.data.hit === true });
    await tick(0, { safety: 0.5, fed: 0.5 });
    expect(await tick(1, { safety: 0.5, fed: 0.5, hit: true })).toMatchObject({ patience: expect.closeTo(0.3), shock: true });
  });

  it("guardrail: names an input that looks broken, and keeps a bad reading out of the outlook", async () => {
    const { tick } = setup({ inputs: [from("safety"), from("fed"), from("equipped")] });
    const data = { safety: 1, fed: 1, equipped: 0 };
    let trace = await tick(0, data);
    for (let s = 1; s < 300; s++) trace = await tick(s, data);
    expect(trace.warnings).toBeUndefined();
    expect((await tick(300, data)).warnings).toEqual(['check outlook input "equipped": it has been 0 for 5 minutes']);
    // Not a number: warned at once, and left out of the average.
    expect(await tick(301, { safety: 1, fed: Number.NaN, equipped: 1 })).toMatchObject({
      outlook: 1,
      inputs: { safety: 1, equipped: 1 },
      warnings: ['check outlook input "fed": it returned NaN'],
    });
  });

  it("adds effect notes to the log", async () => {
    const { tick } = setup({ effects: () => ({ persistence: { skill: "go_to" } }) });
    expect(await tick(0)).toMatchObject({ persistence: { skill: "go_to" } });
  });
});
