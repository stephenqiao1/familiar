import type { State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { describe, expect, it } from "vitest";
import { createFocusRegion, type FocusInput } from "./focus-region.js";
import { DEFAULT_FOCUS } from "./settings.js";

const signal = new AbortController().signal;
type World = { pressure?: number; asleep?: boolean; x?: number; chest?: boolean };
const state = (seconds: number, world: World): State => ({ schemaVersion: 1, tick: seconds, timestamp: seconds * 1000, data: { ...world } });
const pressure: FocusInput = { name: "pressure", read: (ws) => (ws.state.data.pressure as number | undefined) ?? 0 };
const chest = { id: "pos:1,2,3", kind: "chest" };

function setup(options: Partial<Parameters<typeof createFocusRegion>[0]> = {}) {
  const store = createWorkspace();
  const region = createFocusRegion({
    inputs: [pressure],
    settings: DEFAULT_FOCUS,
    asleep: (ws) => ws.state.data.asleep === true,
    moved: (a, b) => a.data.x !== b.data.x,
    ...options,
  });
  let seconds = 0;
  const tick = async (world: World = {}) => {
    store.update(state(seconds++, world), null);
    return region.run(store.viewFor("acetylcholine"), signal);
  };
  const wait = async (forSeconds: number, world: (s: number) => World = () => ({})) => {
    let out = await tick(world(0));
    for (let i = 1; i < forSeconds; i++) out = await tick(world(i));
    return out;
  };
  const value = (name: string) => store.signals()[name]?.value;
  return { region, tick, wait, value };
}

describe("createFocusRegion", () => {
  it("runs every tick on the fastest layer", () => {
    expect(setup().region).toMatchObject({ name: "acetylcholine", layer: 0, everyMs: 0 });
  });

  it("moves focus with its inputs, shares it as a signal, and logs each input", async () => {
    const up = setup();
    const out = await up.wait(120, () => ({ pressure: 1 }));
    expect(out.trace).toMatchObject({ inputs: { pressure: 1 } });
    expect(up.value("focus")).toBeGreaterThan(0.7);
    const down = setup();
    await down.wait(120, () => ({ pressure: -1 }));
    expect(down.value("focus")).toBeLessThan(0.3);
  });

  it("forces focus to 0.05 while asleep", async () => {
    const { tick, value } = setup();
    expect((await tick({ asleep: true, pressure: 1 })).trace).toMatchObject({ focus: 0.05, asleep: true });
    expect(value("focus")).toBe(0.05);
  });

  describe("e) cue pulse", () => {
    const watching = { watched: (ws: { state: State }) => (ws.state.data.chest ? [chest] : []), skillsToward: () => ["go_to"] };

    it("does not fire for a thing seen once", async () => {
      const { tick, value } = setup(watching);
      expect((await tick({ chest: true })).proposals).toEqual([]);
      expect((await tick()).proposals).toEqual([]);
      expect(value("cue")).toBe(0);
    });

    it("fires once when seen twice in a row: a signal, and a short boost for the skill that acts on it", async () => {
      const { tick, wait, value } = setup(watching);
      await tick({ chest: true });
      const fired = await tick({ chest: true });
      expect(value("cue")).toBe(1);
      expect(fired.trace).toMatchObject({ cue: "chest" });
      expect(fired.proposals).toEqual([{ action: { skill: "go_to", target: "pos:1,2,3" }, urgency: 0.6, reason: "spotted the chest it was looking for" }]);
      // The boost lasts a few seconds; the cue itself fired once.
      expect((await tick({ chest: true })).proposals).toHaveLength(1);
      expect(value("cue")).toBe(0);
      expect((await wait(6, () => ({ chest: true }))).proposals).toEqual([]);
    });

    it("asleep, a cue proposes nothing: it is not a wake event", async () => {
      const { tick, value } = setup(watching);
      await tick({ chest: true, asleep: true });
      const fired = await tick({ chest: true, asleep: true });
      expect(value("cue")).toBe(1);
      expect(fired.proposals).toEqual([]);
    });

    it("drops the boost as soon as the thing leaves view", async () => {
      const { tick } = setup(watching);
      await tick({ chest: true });
      await tick({ chest: true });
      expect((await tick()).proposals).toEqual([]);
    });
  });

  it("guardrail: warns after 5 minutes of very low focus while awake and moving, but not at rest or asleep", async () => {
    const low = { resting: 0.05, timeConstantSeconds: 45 };
    const moving = setup({ settings: low });
    expect((await moving.wait(299, (s) => ({ x: s }))).trace?.warning).toBeUndefined();
    expect((await moving.wait(5, (s) => ({ x: 1000 + s }))).trace?.warning).toMatch(/running on assumptions/);

    const still = setup({ settings: low });
    expect((await still.wait(400)).trace?.warning).toBeUndefined();
    const sleeping = setup({ settings: low });
    expect((await sleeping.wait(400, (s) => ({ x: s, asleep: true }))).trace?.warning).toBeUndefined();
  });

  it("adds extra notes to the log", async () => {
    const { tick } = setup({ notes: () => ({ remembered: [{ what: "chest pos:1,2,3", used: false }] }) });
    expect((await tick()).trace).toMatchObject({ remembered: [{ what: "chest pos:1,2,3", used: false }] });
  });
});
