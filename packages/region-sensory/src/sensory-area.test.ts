import { describe, expect, it } from "vitest";
import type { GoalOffer, Region } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { areaRegions, createConditions, type ConditionKind } from "@familiar/neocortex";
import { createSensoryArea, type SensoryOptions, type UsualSource } from "./sensory-area.js";
import { HOLD_MS, known, SIZE, UNEXPECTED_SIGNAL, type Surprise } from "./surprise.js";

const signal = new AbortController().signal;
const LADDER = ["sensory", "instinct", "prefrontal"];
type Scene = { things?: Record<string, string>; changes?: { id: string; kind: string; what: string }[]; band?: string };
/** "sees <kind>": a thing of that kind is in the scene. */
const sees: ConditionKind = { form: "sees <kind>", read: (text) => ((kind) => (kind ? (ws) => Object.values((ws.state.data as Scene).things ?? {}).includes(kind) : null))(/^sees (\w+)$/.exec(text)?.[1]) };
const conditions = createConditions([sees]);

/** A map that has looked about one cell 20 times by day: a chest every time, a cow on a quarter of them, and a door seen to open before. */
const familiar = (over: Partial<UsualSource> = {}): UsualSource => ({
  usual: (_cell, band): ReturnType<UsualSource["usual"]> => (band === "day" ? { looks: 20, share: { chest: 1, cow: 0.25 } } : { looks: 0, share: {} }),
  looksIn: () => 20,
  firstSeenIn: (_area, kind) => (kind === "chest" || kind === "cow" ? 1 : null),
  changeFirst: (change) => (change === "door:changed" ? 1 : null),
  ...over,
});

function setUp(more: Partial<SensoryOptions> = {}, goal?: Partial<GoalOffer>) {
  const store = createWorkspace();
  const [sensory] = areaRegions(
    createSensoryArea({
      strength: 1,
      thingsOf: (view) => Object.entries((view.data as Scene).things ?? {}).map(([id, kind]) => ({ id, kind })),
      changesOf: (view) => (view.data as Scene).changes ?? [],
      bandOf: (view) => (view.data as Scene).band ?? "day",
      usual: familiar(),
      parse: conditions.parse,
      ...more,
    }),
    LADDER,
  ) as [Region];
  const top = store.viewFor("prefrontal");
  if (goal) top.setGoal({ text: "g", steps: [], reason: "", ...goal });
  let ms = 100_000;
  async function tick(scene: Scene = {}, afterMs = 500, aimedAt?: string) {
    ms += afterMs;
    store.update({ schemaVersion: 1, tick: 0, timestamp: ms, data: scene as Record<string, unknown> }, aimedAt ? { skill: "use", target: aimedAt, startedAt: 0 } : null);
    store.viewFor("hippocampus").setPlace({ cell: "c1", area: "a1", familiarity: 1 });
    top.setCortex("prefrontal", { feedback: { goal: store.goal() } });
    const out = await sensory.run(store.viewFor("sensory"), signal);
    const up = store.cortex().sensory!.up as { unexpected: Surprise[] } | null;
    return { proposals: out.proposals, trace: out.trace as Record<string, any>, up, unexpected: store.signals()[UNEXPECTED_SIGNAL]?.value ?? 0, found: ((out.trace as Record<string, any>).unexpected ?? []) as Surprise[] };
  }
  /** The usual scene, long enough for the place to have settled. */
  const settle = async (scene: Scene = { things: { c: "chest" } }) => {
    for (let i = 0; i < 6; i++) await tick(scene);
  };
  return { store, tick, settle, now: () => ms };
}
const usualScene = { things: { c: "chest" } };

describe("the sensory area", () => {
  it("a usual scene raises nothing, and nothing goes up", async () => {
    const s = setUp();
    for (let i = 0; i < 8; i++) {
      const { unexpected, up, proposals } = await s.tick({ things: { c: "chest", w: "cow" } });
      expect([unexpected, up, proposals]).toEqual([0, null, []]);
    }
    // A cow that is here now and then may come and go: it is neither new nor usual.
    expect((await s.tick(usualScene)).unexpected).toBe(0);
    expect((await s.tick({ things: { c: "chest", w: "cow" } }, 20_000)).unexpected).toBe(0);
  });

  it("a kind never seen here raises unexpected, once, naming the things", async () => {
    const s = setUp();
    await s.settle();
    const { unexpected, up, found } = await s.tick({ things: { c: "chest", p1: "pig", p2: "pig" } });
    expect(unexpected).toBeCloseTo(SIZE.new * known(20));
    expect(found).toEqual([{ what: "new", kind: "pig", ids: ["p1", "p2"], size: SIZE.new * known(20), why: "a pig here, where none was seen before", at: s.now() }]);
    expect(up).toEqual({ unexpected: found });
    // It was here a moment ago: it is expected now. The report stands a few seconds, then is gone.
    expect((await s.tick({ things: { c: "chest", p1: "pig", p2: "pig" } })).found).toEqual([]);
    expect((await s.tick({ things: { c: "chest", p1: "pig", p2: "pig" } }, HOLD_MS)).unexpected).toBe(0);
  });

  it("a usual thing missing raises unexpected, once for as long as it stays away", async () => {
    const s = setUp();
    await s.settle();
    // Gone: a moment ago it was here, so for a few seconds it is still expected back.
    expect((await s.tick({}, 1000)).unexpected).toBe(0);
    const { unexpected, found } = await s.tick({}, 5000);
    expect(unexpected).toBeCloseTo(SIZE.missing * known(20));
    expect(found).toMatchObject([{ what: "missing", kind: "chest", ids: [], why: "no chest here, where there usually is one" }]);
    expect((await s.tick({}, 60_000)).found).toEqual([]);
    // Back, and gone again: a new absence is reported anew.
    await s.tick(usualScene);
    expect((await s.tick({}, 6000)).found).toHaveLength(1);
  });

  it("arriving where a usual thing is not: missing once the place has settled, and only what is usual at this time of day", async () => {
    const s = setUp();
    expect((await s.tick({})).found).toEqual([]);
    expect((await s.tick({}, 2000)).found).toMatchObject([{ what: "missing", kind: "chest" }]);
    const night = setUp();
    await night.tick({ band: "night" });
    expect((await night.tick({ band: "night" }, 2000)).unexpected).toBe(0);
  });

  it("a change never seen before raises unexpected; one seen before, or the bot's own doing, does not", async () => {
    const s = setUp();
    await s.settle();
    const opened = { id: "d", kind: "door", what: "changed" };
    const moved = { id: "c", kind: "chest", what: "started_moving" };
    expect((await s.tick({ ...usualScene, changes: [opened] })).unexpected).toBe(0);
    const { unexpected, found } = await s.tick({ ...usualScene, changes: [moved] });
    expect(unexpected).toBe(SIZE.changed);
    expect(found).toMatchObject([{ what: "changed", kind: "chest", ids: ["c"], why: "a chest started moving, as none has before" }]);
    expect((await s.tick({ ...usualScene, changes: [moved] })).found).toEqual([]);
    // What the running skill is aimed at changes because the bot is changing it.
    const own = setUp();
    await own.settle();
    expect((await own.tick({ ...usualScene, changes: [moved] }, 500, "c")).unexpected).toBe(0);
  });

  it("an expectation from above that does not hold counts fully, and is reported once per break", async () => {
    const s = setUp({ usual: familiar({ usual: () => ({ looks: 0, share: {} }) }) }, { expect: [{ what: "sees chest" }] });
    expect((await s.tick(usualScene)).unexpected).toBe(0);
    const { unexpected, found } = await s.tick({});
    expect(unexpected).toBe(1);
    expect(found).toMatchObject([{ what: "expectation", kind: "sees chest", size: 1, why: 'expected "sees chest", and it is not so' }]);
    expect((await s.tick({})).found).toEqual([]);
    await s.tick(usualScene, HOLD_MS);
    expect((await s.tick({})).found).toHaveLength(1);
  });

  it("an expectation with a when is only broken while its when holds, and one not understood is traced", async () => {
    const s = setUp({ usual: familiar({ usual: () => ({ looks: 0, share: {} }), looksIn: () => 0 }) }, { expect: [{ what: "sees chest", when: "sees bed" }, { what: "the chest is full" }] });
    const away = await s.tick({});
    expect(away.unexpected).toBe(0);
    expect(away.trace.unread).toEqual(["the chest is full"]);
    expect((await s.tick({ things: { b: "bed" } })).found).toMatchObject([{ what: "expectation", why: 'expected "sees chest" when "sees bed", and it is not so' }]);
  });

  it("unexpected is the strongest of what stands, scaled by the area's strength", async () => {
    const s = setUp({ strength: 0.5 }, { expect: [{ what: "sees chest" }] });
    await s.settle();
    const { unexpected, up } = await s.tick({ things: { p: "pig" } }, 6000);
    expect(up!.unexpected.map((u) => u.what).sort()).toEqual(["expectation", "missing", "new"]);
    expect(unexpected).toBe(0.5);
  });

  it("in a place it has hardly looked about, nothing is new and nothing is missing", async () => {
    const s = setUp({ usual: familiar({ looksIn: () => 2, usual: () => ({ looks: 2, share: { chest: 1 } }) }) });
    await s.settle({});
    expect((await s.tick({ things: { p: "pig" } }, 6000)).unexpected).toBe(0);
  });

  it("off, asleep or with no state of the game it shares 0 and says nothing", async () => {
    for (const more of [{ strength: 0 }, { paused: () => true }, { thingsOf: () => null }]) {
      const s = setUp(more, { expect: [{ what: "sees chest" }] });
      const { unexpected, up } = await s.tick({ things: { p: "pig" } });
      expect([unexpected, up]).toEqual([0, null]);
    }
  });

  it("takes far under a millisecond a tick", async () => {
    const s = setUp({}, { expect: [{ what: "sees chest", when: "sees bed" }] });
    const scene = { things: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`t${i}`, i % 2 ? "chest" : "cow"])) };
    await s.settle(scene);
    const started = performance.now();
    for (let i = 0; i < 2000; i++) await s.tick(scene, 1);
    expect((performance.now() - started) / 2000).toBeLessThan(0.5);
  });
});
