import { describe, expect, it } from "vitest";
import { createWorkspace } from "@familiar/core";
import { createCingulateRegion } from "./cingulate-region.js";
import { createInward, INWARD_SIGNAL, INWARD_UNDER, inwardNow } from "./inward.js";
import { DEFAULT_CINGULATE } from "./settings.js";

const signal = new AbortController().signal;

describe("looking inward", () => {
  it("needs quiet rest, next to no trouble and a verdict to carry on", () => {
    const at = (more: Partial<Parameters<typeof inwardNow>[0]>) => inwardNow({ quiet: true, trouble: 0, verdict: "carry on", ...more });
    expect(at({})).toBe(true);
    expect(at({ quiet: false })).toBe(false);
    expect(at({ trouble: INWARD_UNDER })).toBe(false);
    expect(at({ trouble: INWARD_UNDER - 0.01 })).toBe(true);
    expect(at({ verdict: "try harder" })).toBe(false);
    expect(at({ verdict: "leave it" })).toBe(false);
  });

  it("each spell has its own beginning", () => {
    const inward = createInward();
    expect(inward.tick(false, 0)).toBeNull();
    expect(inward.tick(true, 500)).toBe(500);
    expect(inward.tick(true, 1000)).toBe(500);
    expect(inward.tick(false, 1500)).toBeNull();
    expect(inward.tick(true, 2000)).toBe(2000);
  });

  function setUp(inward = 1) {
    const store = createWorkspace();
    const now = { quiet: false, pain: 0 };
    const region = createCingulateRegion({
      settings: { ...DEFAULT_CINGULATE, inward },
      sources: [{ name: "pain", read: () => now.pain }],
      stake: () => ({ need: 1, goal: 0, skill: 0 }),
      chance: () => ({ close: 0, unknown: 0, unfamiliar: 0, reflex: false }),
      calls: () => 0,
      quiet: () => now.quiet,
      activity: () => null,
      progress: () => ({ reward: 0, steps: 0, ground: 0 }),
      surprises: () => ({}),
    });
    let ms = 0;
    const tick = () => {
      store.update({ schemaVersion: 1, tick: 0, timestamp: (ms += 500), data: {} }, null);
      const out = region.run(store.viewFor("cingulate"), signal) as { trace?: Record<string, unknown> };
      return { inward: store.trouble()?.inward, shared: store.signals()[INWARD_SIGNAL]?.value, trace: out.trace };
    };
    return { now, tick };
  }

  it("starts in quiet with no trouble, and is shared as a signal", () => {
    const { now, tick } = setUp();
    expect(tick()).toMatchObject({ inward: undefined, shared: 0 });
    now.quiet = true;
    expect(tick()).toMatchObject({ inward: 1000, shared: 1, trace: { inward: { since: 1000 } } });
    expect(tick()).toMatchObject({ inward: 1000, shared: 1 });
  });

  it("ends on the tick trouble rises, and the next spell is a new one", () => {
    const { now, tick } = setUp();
    now.quiet = true;
    tick();
    now.pain = 0.6;
    const hit = tick();
    expect(hit).toMatchObject({ inward: undefined, shared: 0 });
    expect(hit.trace).not.toHaveProperty("inward");
    now.pain = 0;
    let next = tick();
    for (let i = 0; i < 20 && next.inward === undefined; i++) next = tick();
    expect(next.inward).toBeGreaterThan(1000);
  });

  it("ends when the body stops resting", () => {
    const { now, tick } = setUp();
    now.quiet = true;
    tick();
    now.quiet = false;
    expect(tick()).toMatchObject({ inward: undefined, shared: 0 });
  });

  it("with the setting at 0 there is no inward mode and no signal", () => {
    const { now, tick } = setUp(0);
    now.quiet = true;
    const out = tick();
    expect(out.inward).toBeUndefined();
    expect(out.shared).toBeUndefined();
  });
});
