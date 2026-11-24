import type { NeedReading } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { describe, expect, it } from "vitest";
import { createColliculusRegion, type ColliculusOptions, type Percept } from "./colliculus-region.js";
import { AS_BEFORE, DEFAULT_COLLICULUS, type ColliculusSettings, type Features } from "./colliculus-settings.js";

// The colliculus as a whole with the two-dimensional map: wants, the brake, the lean, the
// graded signal, and whether a look was worth it.

const signal = new AbortController().signal;
const none: Features = { suddenness: 0, motion: 0, looming: 0, nearness: 0, loudness: 0, touch: 0 };
const thing = (id: string, features: Partial<Features>, over: Partial<Percept> = {}): Percept => ({ id, kind: "thing", bearing: "left", via: "sight", features: { ...none, ...features }, ...over });
/** Still and near: under the threshold by itself (0.25 × 0.8 = 0.2). */
const still = (id: string, over: Partial<Percept> = {}) => thing(id, { nearness: 0.8 }, over);
const appeared = (id: string, over: Partial<Percept> = {}) => thing(id, { suddenness: 1, nearness: 0.4 }, over);
const need = (name: string, kind: string, level: number): NeedReading => ({ name, kind, level, rank: kind === "safety" ? 1 : 0, weight: 1, pressing: level });

interface World {
  percepts?: Percept[];
  eventful?: boolean;
  wants?: Record<string, number>;
  defence?: { mode: string; target: string | null };
  busy?: "demanding";
}

function colliculus(settings: Partial<ColliculusSettings> = {}, over: Partial<ColliculusOptions> = {}) {
  const store = createWorkspace();
  const world = (ws: { state: { data: unknown } }) => ws.state.data as World;
  const region = createColliculusRegion({
    settings: { ...DEFAULT_COLLICULUS, ...settings },
    percepts: (ws) => world(ws).percepts ?? [],
    eventful: (ws) => world(ws).eventful ?? false,
    wantOf: (kind, ws) => world(ws).wants?.[kind] ?? 0,
    defenceOf: (ws) => world(ws).defence ?? null,
    busy: (ws) => world(ws).busy ?? null,
    idle: (ws) => ws.current === null || ws.current.skill === "idle",
    lookSkill: "look_at",
    ...over,
  });
  let ms = 0;
  const tick = async (w: World = {}, current: { skill: string; target?: string } | null = null, afterMs = 500) => {
    ms += afterMs;
    store.update({ schemaVersion: 1, tick: 0, timestamp: ms, data: { ...w } }, current ? { skill: current.skill, target: current.target, startedAt: 1 } : null);
    const out = await region.run(store.viewFor("colliculus"), signal);
    const look = out.proposals[0];
    return { ...out, trace: out.trace as Record<string, any>, look, target: look && "skill" in look.action ? look.action.target : undefined };
  };
  const needs = (readings: NeedReading[]) => store.viewFor("hypothalamus").setNeeds({ readings });
  return { store, tick, needs, value: (name: string) => store.signals()[name]?.value };
}

describe("up and down on the map", () => {
  it("the attended thing carries its angle, elevation and field, and the trace the jump to it", async () => {
    const { store, tick } = colliculus({}, { pitchOf: () => 10 });
    const out = await tick({ percepts: [appeared("above", { angle: -30, elevation: 50 })] });
    expect(store.attended()).toMatchObject({ id: "above", angle: -30, elevation: 50, field: "upper" });
    expect(out.trace.winner.jump).toEqual({ sideways: -30, upDown: 40 });
    expect(out.trace.top[0]).toMatchObject({ angle: -30, elevation: 50, field: "upper" });
  });

  it("with elevation at 0 everything is level", async () => {
    const { store, tick } = colliculus({ elevation: 0 });
    await tick({ percepts: [appeared("above", { angle: 0, elevation: 50 })] });
    expect(store.attended()?.field).toBe("level");
  });

  it("a still thing in the dark stands out less; a moving one loses less", async () => {
    const top = async (p: Percept) => (await colliculus().tick({ percepts: [p] })).trace.top[0].salience as number;
    const stillLost = (await top(still("s", { light: 1 }))) - (await top(still("s", { light: 0 })));
    const moving = (light: number) => thing("m", { motion: 0.8 }, { light });
    const movingLost = (await top(moving(1))) - (await top(moving(0)));
    expect(stillLost).toBeGreaterThan(0);
    expect(stillLost / 0.2).toBeGreaterThan(movingLost / 0.24);
    expect(await top(still("s", { light: 0 }))).toBeLessThan(await top(still("s", { light: 1 })));
  });
});

describe("priority from what the bot wants", () => {
  const two = [still("bread", { kind: "chest" }), still("stone", { kind: "rock" })];

  it("a wanted kind wins over an equal unwanted one, with no goal asking", async () => {
    const { tick } = colliculus();
    const out = await tick({ percepts: two, wants: { chest: 0.9 } });
    expect(out.target).toBe("bread");
    expect(out.trace.winner.drawnBy).toBe("wanted");
    expect(out.trace.top[0]).toMatchObject({ id: "bread", boostFrom: "wanted", boost: 0.36 });
  });

  it("with nothing wanted neither is looked at; with wants at 0 a want draws nothing", async () => {
    expect((await colliculus().tick({ percepts: two })).look).toBeUndefined();
    expect((await colliculus({ wants: 0 }).tick({ percepts: two, wants: { chest: 1 } })).look).toBeUndefined();
  });

  it("a pressing thing still beats a wanted one, even a less salient one", async () => {
    const { tick } = colliculus();
    const wanted = thing("bread", { nearness: 1, motion: 1 }, { kind: "chest" }); // 0.55 + 0.4 = 0.95
    const diving = thing("diver", { looming: 0.6 }); // 0.6
    expect((await tick({ percepts: [wanted, diving], wants: { chest: 1 } })).target).toBe("diver");
  });
});

describe("holding the gaze on the task", () => {
  const working = { skill: "take_items", target: "chest" };

  it("a mild distraction loses while a skill is aimed at something else, and the trace says what was stopped", async () => {
    const { tick } = colliculus({}, { looksAlongside: () => true });
    const mild = appeared("pig"); // 0.6: over the threshold (0.45), under it with the brake (0.75)
    const out = await tick({ percepts: [mild] }, working);
    expect(out.look).toBeUndefined();
    expect(out.trace.brake).toMatchObject({ stopped: "pig", needed: 0.75, heldOn: "chest" });
    // With nothing aimed at, the same thing wins.
    expect((await colliculus().tick({ percepts: [mild] })).target).toBe("pig");
    // And with fixation at 0.
    expect((await colliculus({ fixation: 0 }, { looksAlongside: () => true }).tick({ percepts: [mild] }, working)).target).toBe("pig");
  });

  it("a touch still wins, and so does something strong enough", async () => {
    const { tick } = colliculus({}, { looksAlongside: () => true });
    expect((await tick({ percepts: [thing("hit", { touch: 1 }, { via: "touch" })] }, working)).target).toBe("hit");
    const strong = thing("runner", { suddenness: 1, motion: 1, nearness: 0.4 }); // 0.9
    expect((await colliculus({}, { looksAlongside: () => true }).tick({ percepts: [strong] }, working)).target).toBe("runner");
  });

  it("the fixated thing itself is never looked at or got used to, and the look itself is not a task", async () => {
    const { tick } = colliculus({}, { looksAlongside: () => true });
    const out = await tick({ percepts: [appeared("chest")] }, working);
    expect(out.look).toBeUndefined();
    expect(out.trace.damped).toBeUndefined();
    // A look under way holds nothing: another thing may win as usual.
    expect((await colliculus().tick({ percepts: [appeared("pig")] }, { skill: "look_at", target: "chest" })).trace.brake).toBeUndefined();
  });

  it("with a demanding skill the two raises never exceed 0.4 in all", async () => {
    const { tick } = colliculus({}, { looksAlongside: () => true });
    const out = await tick({ percepts: [thing("hit", { touch: 1 }, { via: "touch" }), appeared("pig")], busy: "demanding" }, working);
    // Threshold 0.45 + 0.3 for the demanding skill; the brake may add only 0.1 more.
    expect(out.trace.threshold).toBeCloseTo(0.75);
    expect(out.target).toBe("hit");
  });
});

describe("sky and ground", () => {
  const diving = thing("diver", { looming: 0.75 }, { angle: 0, elevation: 60, shape: { dist: 12, across: 0, closing: 6 } });
  const crossing = thing("bird", { motion: 1 }, { angle: 40, elevation: 45, shape: { dist: 20, across: 5, closing: 0 } });
  const small = thing("pig", { suddenness: 1, nearness: 0.75 }, { angle: 20, elevation: -15, shape: { dist: 4, across: 1, closing: 0, height: 0.9 } });

  it("the lean is written to attended: avoid, freeze, approach, or nothing", async () => {
    const leanOf = async (p: Percept, settings: Partial<ColliculusSettings> = {}) => {
      const c = colliculus(settings);
      await c.tick({ percepts: [p] });
      return c.store.attended()?.lean;
    };
    expect(await leanOf(diving)).toBe("avoid");
    expect(await leanOf({ ...crossing, features: { ...none, motion: 1, suddenness: 1 } })).toBe("freeze");
    expect(await leanOf(small)).toBe("approach");
    expect(await leanOf(appeared("plain"))).toBeUndefined();
    expect(await leanOf(diving, { fields: 0 })).toBeUndefined();
    // With no up and down there is no upper field, so no dive from above.
    expect(await leanOf(diving, { elevation: 0 })).toBeUndefined();
  });

  it("no approach while a need for safety presses", async () => {
    const c = colliculus();
    c.needs([need("danger", "safety", 0.6)]);
    await c.tick({ percepts: [small] });
    expect(c.store.attended()).toMatchObject({ id: "pig" });
    expect(c.store.attended()?.lean).toBeUndefined();
  });

  it("a thing worth a closer look is held up to 3 seconds; anything else 2", async () => {
    const heldFor = async (p: Percept) => {
      const c = colliculus();
      await c.tick({ percepts: [p] });
      let ticks = 0;
      while (c.store.attended() && ticks < 12) {
        await c.tick({ percepts: [] });
        ticks++;
      }
      return ticks * 500;
    };
    expect(await heldFor(small)).toBe(3000);
    expect(await heldFor(appeared("plain"))).toBe(2000);
  });
});

describe("the graded orienting signal", () => {
  it("is the new winner's strength, fades within half a second, and is 1 or 0 with event at 0", async () => {
    const { tick, value } = colliculus();
    await tick({ percepts: [appeared("a")] });
    expect(value("orienting")).toBeCloseTo(0.6);
    await tick({ percepts: [appeared("a")] }, null, 250);
    expect(value("orienting")).toBeCloseTo(0.3);
    await tick({ percepts: [appeared("a")] }, null, 250);
    expect(value("orienting")).toBe(0);
    const old = colliculus({ event: 0 });
    await old.tick({ percepts: [appeared("a")] });
    expect(old.value("orienting")).toBe(1);
    await old.tick({ percepts: [appeared("a")] }, null, 250);
    expect(old.value("orienting")).toBe(0);
  });

  it("something the bot caused itself is looked at but sends no signal", async () => {
    const { tick, value } = colliculus();
    const out = await tick({ percepts: [appeared("dug", { own: true })] });
    expect(out.target).toBe("dug");
    expect(value("orienting")).toBe(0);
  });
});

describe("was it worth the look", () => {
  /** Looks at `pig`, lets `follow` happen, lets go, and says how much of its salience it then keeps. */
  async function keptAfter(follow: (c: ReturnType<typeof colliculus>) => Promise<unknown>, settings: Partial<ColliculusSettings> = {}) {
    const c = colliculus(settings);
    c.needs([need("hunger", "hunger", 0.5)]);
    await c.tick({ percepts: [appeared("pig")], defence: { mode: "none", target: null } });
    const released = await follow(c);
    let out = await c.tick({ percepts: [] });
    for (let i = 0; i < 6 && !out.trace.released && !released; i++) out = await c.tick({ percepts: [] });
    const later = await c.tick({ percepts: [still("pig")] });
    return { damped: later.trace.damped as Record<string, number> | undefined, released: (released ?? out.trace.released) as { worth: boolean; why: string } };
  }
  const quiet = { defence: { mode: "none", target: null } };

  it("nothing followed: it is got used to, and the release says so", async () => {
    const { damped, released } = await keptAfter(async () => undefined);
    expect(damped?.["thing pig"]).toBeCloseTo(0.8, 1);
    expect(released).toEqual({ id: "pig", worth: false, why: "nothing followed" });
  });

  it("each of the four reasons stops it being got used to", async () => {
    const reasons: [string, (c: ReturnType<typeof colliculus>) => Promise<unknown>][] = [
      ["hurt or rewarded", (c) => c.tick({ percepts: [appeared("pig")], eventful: true, ...quiet })],
      ["was started on it", (c) => c.tick({ percepts: [appeared("pig")], ...quiet }, { skill: "attack", target: "pig" })],
      ["the need hunger moved", async (c) => (c.needs([need("hunger", "hunger", 0.2)]), c.tick({ percepts: [appeared("pig")], ...quiet }))],
      ["the defence went to flee", (c) => c.tick({ percepts: [appeared("pig")], defence: { mode: "flee", target: "pig" } })],
    ];
    for (const [why, follow] of reasons) {
      const { damped, released } = await keptAfter(async (c) => (await follow(c), undefined));
      expect(damped, why).toBeUndefined();
      expect(released.worth, why).toBe(true);
      expect(released.why, why).toContain(why);
    }
  });

  it("a defence change about something else, or the look itself, does not count", async () => {
    const other = await keptAfter(async (c) => (await c.tick({ percepts: [appeared("pig")], defence: { mode: "flee", target: "wolf" } }), undefined));
    expect(other.released.worth).toBe(false);
    const look = await keptAfter(async (c) => (await c.tick({ percepts: [appeared("pig")], ...quiet }, { skill: "look_at", target: "pig" }), undefined));
    expect(look.released.worth).toBe(false);
  });

  it("what follows within 2 seconds after the look gives back what was lost", async () => {
    const c = colliculus();
    await c.tick({ percepts: [appeared("pig")] });
    let out = await c.tick({ percepts: [] });
    while (!out.trace.released) out = await c.tick({ percepts: [] });
    expect(out.trace.damped).toBeDefined();
    out = await c.tick({ percepts: [] }, { skill: "attack", target: "pig" });
    expect(out.trace.worthAfter).toMatchObject({ id: "pig" });
    expect(out.trace.damped).toBeUndefined();
  });

  it("with followUp at 0 only damage or a reward counts, as before", async () => {
    const started = await keptAfter(async (c) => (await c.tick({ percepts: [appeared("pig")], ...quiet }, { skill: "attack", target: "pig" }), undefined), { followUp: 0, fixation: 0 });
    expect(started.released.worth).toBe(false);
    const hurt = await keptAfter(async (c) => (await c.tick({ percepts: [appeared("pig")], eventful: true, ...quiet }), undefined), { followUp: 0 });
    expect(hurt.released.worth).toBe(true);
  });
});

describe("every new strength at 0", () => {
  it("gives the winners, proposals and signals of the map before it had up and down", async () => {
    const scene: World[] = [
      { percepts: [appeared("a", { angle: 10, elevation: 60, light: 0, shape: { dist: 4, across: 1, closing: 0, height: 0.5 } }), still("b", { kind: "chest" })], wants: { chest: 1 } },
      { percepts: [thing("c", { looming: 0.75 }, { elevation: 70, shape: { dist: 9, across: 0, closing: 6 } })] },
      { percepts: [still("b", { kind: "chest" })], wants: { chest: 1 } },
      { percepts: [appeared("d", { own: true })] },
    ];
    const c = colliculus(AS_BEFORE);
    const seen = [];
    for (const w of scene) {
      const out = await c.tick(w, { skill: "idle" }, 1500);
      seen.push({ target: out.target, urgency: out.look?.urgency, orienting: c.value("orienting"), lean: c.store.attended()?.lean, field: c.store.attended()?.field, brake: out.trace.brake, boost: out.trace.top[0]?.boostFrom });
    }
    expect(seen.map((s) => s.target)).toEqual(["a", "c", undefined, "d"]);
    expect(seen.map((s) => s.orienting)).toEqual([1, 1, 0, 1]);
    expect(seen.every((s) => s.lean === undefined && s.brake === undefined && s.boost === undefined)).toBe(true);
    expect(seen.filter((s) => s.field).every((s) => s.field === "level")).toBe(true);
    // Salience is not dimmed by the dark: "a" scores as it always did.
    expect((await colliculus(AS_BEFORE).tick(scene[0]!)).trace.top[0].salience).toBeCloseTo(0.6);
  });
});
