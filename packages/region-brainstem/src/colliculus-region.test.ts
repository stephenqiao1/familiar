import { createWorkspace } from "@familiar/core";
import { describe, expect, it } from "vitest";
import { createColliculusRegion, type ColliculusOptions, type Percept } from "./colliculus-region.js";
import { colliculusProblem, DEFAULT_COLLICULUS, FEATURES, type ColliculusSettings, type Features } from "./colliculus-settings.js";
import { createHabituation } from "./habituation.js";
import { salienceOf } from "./salience.js";

const signal = new AbortController().signal;
const none: Features = { suddenness: 0, motion: 0, looming: 0, nearness: 0, loudness: 0, touch: 0 };
/** A thing on the map. */
const thing = (id: string, features: Partial<Features>, over: Partial<Percept> = {}): Percept => ({ id, kind: "thing", bearing: "left", via: "sight", features: { ...none, ...features }, ...over });
const appeared = (id: string, over: Partial<Percept> = {}) => thing(id, { suddenness: 1, nearness: 0.4 }, over);

interface World {
  percepts?: Percept[];
  asleep?: boolean;
  busy?: "reflex" | "demanding";
  eventful?: boolean;
  spoken?: boolean;
}

function colliculus(settings: Partial<ColliculusSettings> = {}, over: Partial<ColliculusOptions> = {}) {
  const store = createWorkspace();
  const world = (ws: { state: { data: unknown } }) => ws.state.data as World;
  const region = createColliculusRegion({
    settings: { ...DEFAULT_COLLICULUS, ...settings },
    percepts: (ws) => world(ws).percepts ?? [],
    alarmOf: (ws) => ws.signals.alarm?.value ?? 0,
    arousalOf: (ws) => ws.signals.arousal?.value ?? 0.5,
    asleep: (ws) => world(ws).asleep ?? false,
    busy: (ws) => world(ws).busy ?? null,
    eventful: (ws) => world(ws).eventful ?? false,
    idle: (ws) => ws.current === null || ws.current.skill === "idle",
    spoken: (ws) => world(ws).spoken ?? false,
    lookSkill: "look_at",
    ...over,
  });
  let ms = 0;
  const tick = async (w: World = {}, current: string | null = null, afterMs = 500) => {
    ms += afterMs;
    store.update({ schemaVersion: 1, tick: 0, timestamp: ms, data: { ...w } }, current ? { skill: current, target: undefined, startedAt: 0 } : null);
    const out = await region.run(store.viewFor("colliculus"), signal);
    const look = out.proposals[0];
    return { ...out, look, target: look && "skill" in look.action ? look.action.target : undefined };
  };
  const value = (name: string) => store.signals()[name]?.value;
  return { store, tick, value };
}

describe("salienceOf", () => {
  it("adds the weighted features, and takes nothing else", () => {
    expect(salienceOf({ ...none, suddenness: 1, nearness: 0.4 }, "sight", DEFAULT_COLLICULUS)).toBeCloseTo(0.5 + 0.25 * 0.4);
    // Its only inputs are the six features, the sense and the bot's own settings.
    expect(salienceOf.length).toBe(3);
    expect([...FEATURES]).toEqual(["suddenness", "motion", "looming", "nearness", "loudness", "touch"]);
  });

  it("sight, hearing and looming can each be turned down; touch cannot", () => {
    const blind = { ...DEFAULT_COLLICULUS, sight: 0 };
    expect(salienceOf({ ...none, suddenness: 1, looming: 1 }, "sight", blind)).toBe(0);
    expect(salienceOf({ ...none, loudness: 1 }, "sound", { ...DEFAULT_COLLICULUS, hearing: 0.5 })).toBeCloseTo(0.3);
    expect(salienceOf({ ...none, looming: 1 }, "sight", { ...DEFAULT_COLLICULUS, looming: 0 })).toBe(0);
    expect(salienceOf({ ...none, touch: 1 }, "touch", blind)).toBe(3);
  });
});

describe("the map: one winner", () => {
  it("runs every tick on the fastest layer", () => {
    expect(createColliculusRegion({ settings: DEFAULT_COLLICULUS, percepts: () => [], idle: () => true, lookSkill: "look_at" })).toMatchObject({ name: "colliculus", layer: 0, everyMs: 0 });
  });

  it("turns to the most striking thing, says it is attended, and shares orienting for that tick", async () => {
    const { store, tick, value } = colliculus();
    expect((await tick()).proposals).toEqual([]);
    const out = await tick({ percepts: [appeared("entity:1", { kind: "zombie" }), thing("entity:2", { nearness: 0.9 })] });
    expect(out.target).toBe("entity:1");
    expect(store.attended()).toMatchObject({ id: "entity:1", kind: "zombie", bearing: "left", salience: 0.6 });
    expect(value("orienting")).toBe(1);
    expect(out.trace).toMatchObject({ winner: { id: "entity:1", why: "sight: suddenness" }, threshold: 0.45, top: [{ id: "entity:1", parts: { suddenness: 0.5, nearness: 0.1 } }, { id: "entity:2" }] });
    expect((await tick({ percepts: [thing("entity:1", { nearness: 0.3 })] })).proposals).toEqual([]);
    expect(value("orienting")).toBe(0);
  });

  it("a still thing does not win by being near", async () => {
    const { store, tick } = colliculus();
    expect((await tick({ percepts: [thing("entity:1", { nearness: 1 })] })).proposals).toEqual([]);
    expect(store.attended()).toBeNull();
  });

  it("the looming thing beats the near still thing; touch beats everything", async () => {
    const near = thing("entity:1", { nearness: 1, suddenness: 1 });
    const looming = thing("entity:2", { looming: 1, nearness: 0.1 });
    const touch = thing("entity:3", { touch: 1 }, { via: "touch" });
    expect((await colliculus().tick({ percepts: [near, looming] })).target).toBe("entity:2");
    expect((await colliculus().tick({ percepts: [near, looming, touch] })).target).toBe("entity:3");
  });

  it("shares looming, whether or not the looming thing wins the look", async () => {
    const { tick, value } = colliculus();
    await tick({ percepts: [thing("entity:2", { looming: 0.75 }), thing("entity:3", { touch: 1 }, { via: "touch" })] });
    expect(value("looming")).toBe(0.75);
    await tick();
    expect(value("looming")).toBe(0);
  });

  it("holds the winner for at least a second, lets go after two, and takes at most one new look a second", async () => {
    const { store, tick } = colliculus();
    await tick({ percepts: [appeared("entity:1")] });
    // Half a second later something else appears: the first is still held.
    expect((await tick({ percepts: [appeared("entity:2")] })).proposals).toEqual([]);
    expect(store.attended()?.id).toBe("entity:1");
    // A second on, the new thing takes over.
    expect((await tick({ percepts: [appeared("entity:2")] })).target).toBe("entity:2");
    // With nothing striking left it is let go after two seconds.
    await tick({}, null, 1000);
    expect(store.attended()?.id).toBe("entity:2");
    await tick({}, null, 1100);
    expect(store.attended()).toBeNull();
  });

  it("something looming or touching does not wait for the hold", async () => {
    const { tick } = colliculus();
    await tick({ percepts: [appeared("entity:1")] });
    expect((await tick({ percepts: [appeared("entity:1"), thing("entity:9", { looming: 1 })] }, null, 200)).target).toBe("entity:9");
  });
});

describe("bias from above", () => {
  it("a watched kind beats an equal unwatched one", async () => {
    const { store, tick } = colliculus();
    store.viewFor("prefrontal").setGoal({ text: "find a villager", steps: [], reason: "", watchFor: ["villager"] });
    const out = await tick({ percepts: [appeared("entity:1", { kind: "cow" }), appeared("entity:2", { kind: "villager" })] });
    expect(out.target).toBe("entity:2");
    const plain = colliculus({ topDown: 0 });
    plain.store.viewFor("prefrontal").setGoal({ text: "find a villager", steps: [], reason: "", watchFor: ["villager"] });
    expect((await plain.tick({ percepts: [appeared("entity:1", { kind: "cow" }), appeared("entity:2", { kind: "villager" })] })).target).toBe("entity:1");
  });

  it("the threshold falls with alarm and arousal, and rises during a demanding skill", async () => {
    const mild = thing("entity:1", { motion: 1, nearness: 0.3 }); // 0.375: under the resting 0.45
    const calm = colliculus();
    expect((await calm.tick({ percepts: [mild] })).trace).toMatchObject({ threshold: 0.45 });
    expect(calm.store.attended()).toBeNull();
    const alarmed = colliculus();
    alarmed.store.viewFor("noradrenaline").setSignal("alarm", 1);
    alarmed.store.viewFor("brainstem").setSignal("arousal", 1);
    const out = await alarmed.tick({ percepts: [mild] });
    expect(out.trace).toMatchObject({ threshold: 0.1 });
    expect(out.target).toBe("entity:1");
    expect((await colliculus().tick({ busy: "demanding", percepts: [mild] }, "attack")).trace).toMatchObject({ threshold: 0.75 });
  });

  it("asleep, only touch and loud sounds win", async () => {
    const asleep = (percepts: Percept[]) => colliculus().tick({ asleep: true, percepts }, "sleep");
    expect((await asleep([appeared("entity:1"), thing("entity:2", { looming: 1 })])).proposals).toEqual([]);
    expect((await asleep([thing("pos:1,2,3", { loudness: 0.3, suddenness: 1 }, { via: "sound" })])).proposals).toEqual([]);
    expect((await asleep([thing("pos:1,2,3", { loudness: 0.9, suddenness: 1 }, { via: "sound" })])).target).toBe("pos:1,2,3");
    expect((await asleep([thing("entity:3", { touch: 1 }, { via: "touch" })])).target).toBe("entity:3");
  });

  it("a low threshold makes a jumpy bot, a high one an unbothered bot", async () => {
    const mild = thing("entity:1", { motion: 1 });
    expect((await colliculus({ threshold: 0.2 }).tick({ percepts: [mild] })).target).toBe("entity:1");
    expect((await colliculus({ threshold: 0.9 }).tick({ percepts: [appeared("entity:1")] })).proposals).toEqual([]);
  });
});

describe("habituation, and not looking straight back", () => {
  /** The same harmless thing shows up again every 8 seconds. */
  async function wins(c: ReturnType<typeof colliculus>, percept: Percept, times: number, gapMs = 8000): Promise<number[]> {
    const saliences: number[] = [];
    for (let i = 0; i < times; i++) {
      const out = await c.tick({ percepts: [percept] }, null, 500);
      saliences.push(out.target ? (c.store.attended()?.salience ?? 0) : 0);
      await c.tick({}, null, 2100); // let go: nothing followed
      await c.tick({}, null, gapMs - 2600);
    }
    return saliences;
  }

  it("the same harmless thing wins less each time, then not at all, and recovers after about a minute", async () => {
    const c = colliculus();
    const cow = appeared("entity:1", { kind: "cow", place: "0,0" });
    const [first, second, third] = await wins(c, cow, 3);
    expect(first).toBeCloseTo(0.6);
    expect(second).toBeLessThan(first!);
    expect(third).toBe(0); // under the threshold now
    await c.tick({}, null, 70_000);
    expect((await c.tick({ percepts: [cow] })).target).toBe("entity:1");
  });

  it("getting used to a kind of thing in a place carries over to another of that kind there", async () => {
    const c = colliculus();
    await wins(c, appeared("entity:1", { kind: "cow", place: "0,0" }), 2);
    expect((await c.tick({ percepts: [appeared("entity:2", { kind: "cow", place: "0,0" })] })).proposals).toEqual([]);
    expect((await c.tick({ percepts: [appeared("entity:3", { kind: "cow", place: "5,5" })] }, null, 1500)).target).toBe("entity:3");
  });

  it("a new behaviour restores it at once", async () => {
    const c = colliculus();
    const cow = appeared("entity:1", { kind: "cow", place: "0,0" });
    await wins(c, cow, 3);
    expect((await c.tick({ percepts: [cow] })).proposals).toEqual([]);
    const out = await c.tick({ percepts: [{ ...cow, fresh: true }] });
    expect(out.target).toBe("entity:1");
    expect(c.store.attended()?.salience).toBeCloseTo(0.6);
  });

  it("a thing that brought something (damage, a reward) is not got used to", async () => {
    const c = colliculus();
    const zombie = appeared("entity:1", { kind: "zombie", place: "0,0" });
    await c.tick({ percepts: [zombie] });
    await c.tick({ eventful: true });
    await c.tick({}, null, 2100);
    await c.tick({}, null, 3000);
    await c.tick({ percepts: [zombie] });
    expect(c.store.attended()?.salience).toBeCloseTo(0.6);
  });

  it("the thing just looked at cannot win again for 3 seconds, unless it looms", async () => {
    const c = colliculus({}, {});
    const thingA = appeared("entity:1", { fresh: true }); // fresh, so habituation is not what stops it
    await c.tick({ percepts: [thingA] });
    await c.tick({}, null, 2100); // let go
    expect((await c.tick({ percepts: [thingA] }, null, 1000)).proposals).toEqual([]);
    expect((await c.tick({ percepts: [thing("entity:1", { looming: 1 }, { fresh: true })] }, null, 500)).target).toBe("entity:1");
    const d = colliculus();
    await d.tick({ percepts: [thingA] });
    await d.tick({}, null, 2100);
    expect((await d.tick({ percepts: [thingA] }, null, 3100)).target).toBe("entity:1");
  });

  it("with habituation off, neither happens", async () => {
    const c = colliculus({ habituation: 0 });
    const cow = appeared("entity:1");
    const saliences = await wins(c, cow, 3);
    expect(saliences.every((s) => Math.abs(s - 0.6) < 0.01)).toBe(true);
  });

  it("damps a step each time, down to a floor, and comes back steadily", () => {
    const h = createHabituation();
    expect(h.factor(["a"], 0)).toBe(1);
    h.damp(["a", "b"], 0);
    expect(h.factor(["a"], 0)).toBeCloseTo(0.8);
    expect(h.factor(["a"], 30_000)).toBeCloseTo(0.9);
    expect(h.factor(["a", "c"], 60_000)).toBe(1);
    for (let i = 0; i < 20; i++) h.damp(["a"], 70_000);
    expect(h.factor(["a"], 70_000)).toBeCloseTo(0.1);
    h.restore(["a"]);
    expect(h.factor(["a"], 70_000)).toBe(1);
  });
});

describe("what it does about it", () => {
  it("urgency rises with salience, from 0.35 to 0.7", async () => {
    const urgency = async (features: Partial<Features>) => (await colliculus().tick({ percepts: [thing("entity:1", features)] }, "go_to")).look?.urgency;
    expect(await urgency({ suddenness: 1 })).toBeCloseTo(0.37, 1);
    expect(await urgency({ suddenness: 1, looming: 1 })).toBe(0.7);
    expect(await urgency({ touch: 1 })).toBe(0.7);
  });

  it("idle or doing nothing, the look takes over (at the urgency asked); beside a skill, it runs alongside; otherwise it competes", async () => {
    const takesOver = colliculus({}, { idleLookUrgency: 1 });
    const idle = await takesOver.tick({ percepts: [appeared("entity:1")] });
    expect(idle.look?.urgency).toBe(1);
    expect(idle.trace).toMatchObject({ look: { how: "takes over" } });
    const beside = colliculus({}, { idleLookUrgency: 1, looksAlongside: () => true });
    const out = await beside.tick({ percepts: [appeared("entity:1")] }, "eat");
    expect(out.look?.urgency).toBeLessThan(0.7);
    expect(out.trace).toMatchObject({ look: { how: "alongside" } });
    const working = await colliculus({}, { idleLookUrgency: 1 }).tick({ percepts: [appeared("entity:1")] }, "go_to");
    expect(working.look?.urgency).toBeLessThan(0.7);
    expect(working.trace).toMatchObject({ look: { how: "competes" } });
  });

  it("does not take over when a reflex, a startle or a loaded response has spoken this tick", async () => {
    const out = await colliculus({}, { idleLookUrgency: 1 }).tick({ spoken: true, percepts: [appeared("entity:1")] });
    expect(out.look?.urgency).toBeLessThan(0.7);
  });

  it("never interrupts a hard reflex's skill or a demanding skill, except for touch and looming", async () => {
    for (const busy of ["reflex", "demanding"] as const) {
      const c = colliculus();
      expect((await c.tick({ busy, percepts: [appeared("entity:1"), thing("pos:1,1,1", { loudness: 1, suddenness: 1 }, { via: "sound" })] }, "attack")).proposals).toEqual([]);
      expect(c.store.attended()).toBeNull();
      expect((await c.tick({ busy, percepts: [thing("entity:2", { looming: 1 })] }, "attack")).target).toBe("entity:2");
      expect((await colliculus().tick({ busy, percepts: [thing("entity:3", { touch: 1 }, { via: "touch" })] }, "attack")).target).toBe("entity:3");
    }
  });
});

describe("when nothing stands out", () => {
  it("at rest, glances somewhere every few seconds; never while working, asleep or attending to something", async () => {
    let glances = 0;
    const scan = () => `pos:${++glances},64,0`;
    const c = colliculus({}, { scan });
    expect((await c.tick({}, null, 5000)).target).toBe("pos:1,64,0");
    expect((await c.tick({}, null, 1000)).proposals).toEqual([]);
    expect((await c.tick({}, null, 3500)).target).toBe("pos:2,64,0");
    expect((await c.tick({}, "go_to", 5000)).proposals).toEqual([]);
    expect((await c.tick({ asleep: true }, "idle", 5000)).proposals).toEqual([]);
    expect((await c.tick({ percepts: [appeared("entity:1")] }, null, 5000)).target).toBe("entity:1");
    expect((await colliculus({ scanning: 0 }, { scan }).tick({}, null, 9000)).proposals).toEqual([]);
  });
});

describe("guardrails", () => {
  it("what a thing is cannot change its salience: only the goal's watched kinds can", async () => {
    const as = async (kind: string) => {
      const c = colliculus();
      await c.tick({ percepts: [appeared("entity:1", { kind })] });
      return c.store.attended()?.salience;
    };
    expect(await as("zombie")).toBe(await as("cow"));
    expect(await as("creeper")).toBe(await as("oak_log"));
  });

  it("the map's inputs contain no identity fields", () => {
    const identity = ["kind", "type", "name", "hostile", "friendly", "reachable", "id"];
    expect(FEATURES.filter((f) => identity.includes(f))).toEqual([]);
    expect(Object.keys(DEFAULT_COLLICULUS.weights).sort()).toEqual([...FEATURES].sort());
  });

  it("stays cheap with 30 things on the map", async () => {
    const c = colliculus();
    const percepts = Array.from({ length: 30 }, (_, i) => thing(`entity:${i}`, { nearness: i / 30, motion: (i % 5) / 5, suddenness: i % 7 === 0 ? 1 : 0 }, { kind: `k${i % 4}`, place: `${i % 3},0` }));
    for (let i = 0; i < 20; i++) await c.tick({ percepts }); // warm up
    const started = performance.now();
    for (let i = 0; i < 200; i++) await c.tick({ percepts });
    expect((performance.now() - started) / 200).toBeLessThan(2);
  });
});

describe("colliculusProblem", () => {
  it("accepts the defaults and names what is wrong otherwise", () => {
    expect(colliculusProblem(DEFAULT_COLLICULUS)).toBeNull();
    expect(colliculusProblem({ ...DEFAULT_COLLICULUS, threshold: 0 })).toMatch(/threshold must be above 0/);
    expect(colliculusProblem({ ...DEFAULT_COLLICULUS, fieldOfView: 2 })).toMatch(/fieldOfView must be 0 to 1/);
    expect(colliculusProblem({ ...DEFAULT_COLLICULUS, weights: { ...DEFAULT_COLLICULUS.weights, looming: -1 } })).toMatch(/weights.looming must be 0 or more/);
    expect(colliculusProblem({ ...DEFAULT_COLLICULUS, weights: { ...DEFAULT_COLLICULUS.weights, hostile: 1 } as never })).toMatch(/weights.hostile is not a feature/);
  });
});
