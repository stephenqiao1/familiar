import type { State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { describe, expect, it } from "vitest";
import { createPatienceRegion } from "./patience-region.js";
import { DEFAULT_PATIENCE } from "./settings.js";

const signal = new AbortController().signal;
const state = (seconds: number, data: Record<string, unknown> = {}): State => ({ schemaVersion: 1, tick: seconds, timestamp: seconds * 1000, data });

/** A region whose needs are the numbers in the state's data, each at weight 1. */
function setup(options: Partial<Parameters<typeof createPatienceRegion>[0]> = {}) {
  const store = createWorkspace();
  const region = createPatienceRegion({ needs: (ws) => Object.entries(ws.state.data as Record<string, number>).map(([name, level]) => ({ name, level, weight: 1 })), settings: DEFAULT_PATIENCE, ...options });
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

  it("works the outlook out from the needs, and shares patience and outlook as signals", async () => {
    const { store, tick } = setup();
    expect(await tick(0, { hunger: 1, danger: 0 })).toEqual({ patience: 0.5, outlook: 0.5, needs: { hunger: 1, danger: 0 } });
    expect(store.signals()).toMatchObject({ patience: { value: 0.5, source: "serotonin" }, outlook: { value: 0.5 } });
  });

  it("rests when no need is known", async () => {
    const { tick } = setup();
    expect(await tick(0)).toMatchObject({ outlook: null, needs: {} });
  });

  it("falls within seconds when a need turns pressing", async () => {
    const { tick } = setup();
    for (let s = 0; s < 300; s++) await tick(s, { danger: 0 });
    const calm = (await tick(300, { danger: 0 })).patience as number;
    await tick(301, { danger: 1 });
    await tick(302, { danger: 1 });
    expect(calm - ((await tick(303, { danger: 1 })).patience as number)).toBeGreaterThan(0.3);
  });

  it("adds effect notes to the log", async () => {
    const { tick } = setup({ effects: () => ({ persistence: { skill: "go_to" } }) });
    expect(await tick(0)).toMatchObject({ persistence: { skill: "go_to" } });
  });
});
