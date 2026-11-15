// Behaviour tests for the spinal cord and brainstem layer, run through the bot's real wiring:
// createBrain (every region, the player's reflexes and brainstem settings) and the arbiter.
// Only the world, the engine and the planner are made up.

import type { Answer, Candidate, DecisionEngine, Plan, Planner, Question, Skill, State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { createMemory } from "@familiar/memory";
import { createChestMemory, SCHEMA_VERSION, type MinecraftStateData } from "@familiar/minecraft";
import {
  createNoveltyMemory,
  createPersistence,
  createScorebook,
  DEFAULT_FOCUS,
  DEFAULT_NORADRENALINE,
  DEFAULT_PATIENCE,
  DEFAULT_PERSONALITY,
} from "@familiar/neuromodulators";
import { DEFAULT_BRAINSTEM, type BrainstemSettings } from "@familiar/region-brainstem";
import type { FiredReflex } from "@familiar/region-reflex";
import { describe, expect, it } from "vitest";
import { createArbiter, createBrain } from "./brain.js";

const signal = new AbortController().signal;
const ALL_OFF: BrainstemSettings = { bravery: 0.5, gains: 0, startle: 0, orienting: 0, loadedResponses: 0, holdBack: 0, arousalGate: 0, bodySignals: 0 };
type Mob = MinecraftStateData["nearby"]["mobs"][number];
const mob = (type: string, dist: number, id = 1): Mob => ({ id: `entity:${id}`, type, dist, hostile: true, reachable: true });

type Patch = { self?: Partial<MinecraftStateData["self"]>; mobs?: Mob[]; night?: boolean };

/** Healthy, fed and alone by day, unless the patch says otherwise. */
function state(p: Patch, ms: number): State {
  const data: MinecraftStateData = {
    time: { isNight: p.night ?? false, lightLevel: p.night ? 4 : 15 },
    self: {
      position: { x: 0, y: 63, z: 0 },
      dimension: "overworld",
      health: 20,
      food: 20,
      heldItem: null,
      bestWeapon: null,
      inventoryFullPct: 0,
      foodItems: 0,
      inventory: {},
      distanceToBase: 0,
      biome: "plains",
      skyLight: 15,
      enclosed: false,
      asleep: false,
      deaths: 0,
      air: 20,
      onFire: false,
      inLava: false,
      inWater: false,
      falling: false,
      lastHurt: null,
      ...p.self,
    },
    nearby: { hazards: [], mobs: p.mobs ?? [], blocks: [], players: [], loud: [] },
    memory: null,
    current: null,
  };
  return { schemaVersion: SCHEMA_VERSION, tick: 0, timestamp: ms, data: { ...data } };
}

const skill = (name: string, flags: Partial<Skill<null>> = {}): Skill<null> => ({ name, description: name, canRun: () => true, run: async () => ({ status: "done" }), ...flags });
const skills = [
  ...["go_to", "idle", "eat", "flee", "sleep"].map((name) => skill(name)),
  skill("attack", { risky: true }),
  skill("escape_hazard", { reflexOnly: true }),
  skill("surface", { reflexOnly: true }),
  skill("look_at", { primitive: true }),
  skill("brace", { primitive: true }),
];

/** The whole brain on one workspace, one tick at a time. The engine prefers the running skill, else idles. */
function bot(options: { brainstem?: Partial<BrainstemSettings>; only?: string[]; engineFails?: boolean; plan?: Plan } = {}) {
  const store = createWorkspace();
  const calls = { engine: 0, planner: 0, menus: [] as string[][] };
  const engine: DecisionEngine = {
    name: "fake",
    async decide(_state, questions: Question[]): Promise<Answer[]> {
      calls.engine++;
      if (options.engineFails) throw new Error("engine down");
      const next = questions.find((q) => q.kind === "choice" && q.id === "next_action");
      if (next?.kind !== "choice") return [];
      calls.menus.push(next.options);
      const choice = store.viewFor("x").current?.skill ?? "idle";
      return [{ kind: "choice", id: "next_action", choice, probabilities: { [choice]: 0.9 }, confidence: 0.9 }];
    },
  };
  const planner: Planner = {
    name: "fake",
    async plan() {
      calls.planner++;
      return options.plan ?? { goal: "Stay safe.", steps: [], reason: "" };
    },
  };
  const scorebook = createScorebook();
  const persistence = createPersistence({ patience: () => 0.5, chanceOf: () => 0.5, strength: 1 });
  const regions = createBrain(
    {
      engine,
      planner,
      scorebook,
      novelty: createNoveltyMemory(),
      personality: DEFAULT_PERSONALITY,
      patience: DEFAULT_PATIENCE,
      noradrenaline: DEFAULT_NORADRENALINE,
      focus: DEFAULT_FOCUS,
      brainstem: { ...DEFAULT_BRAINSTEM, ...options.brainstem },
      memory: createMemory(),
      persistence,
      storage: { chests: createChestMemory(), baseChest: "pos:0,63,0" },
      skills,
      ctx: null,
    },
    options.only,
  );
  const arbiter = createArbiter({ scorebook, personality: DEFAULT_PERSONALITY, patience: DEFAULT_PATIENCE, skills });
  let ms = 0;
  /** Runs every region in the brain's order (the planner too), then the arbiter. */
  async function tick(patch: Patch = {}, running: string | null = null, afterMs = 500) {
    ms += afterMs;
    store.update(state(patch, ms), running ? { skill: running, target: undefined, startedAt: 0 } : null);
    const candidates: Candidate[] = [];
    const traces: Record<string, Record<string, unknown>> = {};
    const errors: string[] = [];
    for (const region of regions) {
      try {
        const out = await region.run(store.viewFor(region.name), signal);
        traces[region.name] = out.trace ?? {};
        candidates.push(...out.proposals.map((p) => ({ ...p, region: region.name, layer: region.layer })));
      } catch {
        errors.push(region.name);
      }
    }
    const winner = arbiter.pick(candidates, store.viewFor("arbiter"));
    const won = winner && "skill" in winner.action ? winner.action.skill : null;
    const reflexes = (traces.reflex?.rules as FiredReflex[] | undefined) ?? [];
    return { winner, won, candidates, traces, errors, reflexes };
  }
  const value = (name: string) => store.signals()[name]?.value;
  return { store, calls, tick, value };
}

describe("reflex gains through the real brain", () => {
  it("a soft reflex is damped while calm and boosted once alarm has risen", async () => {
    const { tick } = bot();
    await tick();
    const first = await tick({ mobs: [mob("zombie", 6)] });
    expect(first.reflexes).toMatchObject([{ rule: "threat_approaching", kind: "soft", skill: "flee", base: 0.7 }]);
    expect(first.reflexes[0]!.gain).toBeCloseTo(0.6); // alarm was still 0 when the reflex fired
    const second = await tick({ mobs: [mob("zombie", 6)] });
    expect(second.reflexes[0]!.gain).toBeGreaterThan(1); // the alarm raised on the first tick now counts
    expect(second.won).toBe("flee");
  });

  it("a brave bot fights harder and flees less than a timid one in the same ambush", async () => {
    const armed = { self: { bestWeapon: "stone_sword" } };
    const gains = async (bravery: number) => {
      const { tick } = bot({ brainstem: { bravery } });
      await tick();
      await tick({ mobs: [mob("zombie", 6)] });
      const flee = (await tick({ mobs: [mob("zombie", 6)] })).reflexes[0]!;
      const attack = (await tick({ ...armed, mobs: [mob("zombie", 2)] })).reflexes[0]!;
      return { flee, attack };
    };
    const [brave, timid] = [await gains(0.8), await gains(0.2)];
    expect(brave.attack.skill).toBe("attack");
    expect(brave.flee.gain).toBeLessThan(timid.flee.gain);
    expect(brave.attack.gain).toBeGreaterThan(timid.attack.gain);
  });

  it("a goal that holds back flee damps it to 0.3 of its gain; last_stand still pulls the bot out", async () => {
    const free = bot();
    const held = bot();
    for (const b of [free, held]) await b.tick();
    held.store.viewFor("prefrontal").setGoal({ text: "Stand and fight", steps: [], reason: "", holdBack: ["flee"] });
    const zombie = { mobs: [mob("zombie", 2)] };
    for (const b of [free, held]) await b.tick(zombie);
    const [a, b] = [await free.tick(zombie), await held.tick(zombie)];
    expect(b.reflexes[0]!.gain).toBeCloseTo(a.reflexes[0]!.gain * 0.3);
    expect(b.reflexes[0]!.urgency).toBeLessThan(a.reflexes[0]!.urgency);

    // A hard reflex ignores the hold-back entirely.
    const dying = await held.tick({ self: { health: 6 }, mobs: [mob("zombie", 2)] });
    expect(dying.reflexes).toContainEqual({ rule: "last_stand", kind: "hard", skill: "flee", base: 1, gain: 1, urgency: 1 });
    expect(dying.winner).toMatchObject({ region: "reflex", urgency: 1, action: { skill: "flee" } });
  });

  it("guardrail: no alarm, bravery or gain can push a soft reflex to urgency 1, or a hard one below it", async () => {
    for (const bravery of [0, 0.5, 1]) {
      const { store, tick } = bot({ brainstem: { bravery } });
      await tick();
      store.viewFor("prefrontal").setGoal({ text: "g", steps: [], reason: "", holdBack: ["in_lava_or_fire", "drowning", "last_stand", "escape_hazard", "surface"] });
      const scene = { self: { health: 4, inLava: true, inWater: true, air: 2, food: 2, foodItems: 3, bestWeapon: "stone_sword" }, mobs: [mob("zombie", 2)] };
      for (let i = 0; i < 6; i++) {
        const { reflexes } = await tick(scene);
        for (const r of reflexes) {
          if (r.kind === "hard") expect(r.urgency).toBe(1);
          else expect(r.urgency).toBeLessThanOrEqual(0.95);
        }
        expect(reflexes.filter((r) => r.kind === "hard").map((r) => r.rule)).toEqual(["in_lava_or_fire", "drowning", "last_stand"]);
      }
    }
  });
});

describe("defence by distance through the real brain", () => {
  it("a far threat draws a look, not a retreat, and the look beats idling", async () => {
    const { tick, value } = bot();
    await tick({}, "idle");
    const out = await tick({ mobs: [mob("zombie", 12)] }, "idle");
    expect(out.reflexes).toEqual([]);
    expect(value("orienting")).toBe(1);
    expect(out.winner).toMatchObject({ region: "brainstem", action: { skill: "look_at", target: "entity:1" } });
    expect(out.candidates.some((c) => "skill" in c.action && c.action.skill === "flee")).toBe(false);
  });

  it("a look never competes with a reflex: a threat that appears close gets the reflex, not a look", async () => {
    const { tick } = bot({ brainstem: { startle: 0 } });
    await tick({}, "idle");
    const out = await tick({ mobs: [mob("zombie", 6)] }, "idle");
    expect(out.traces.brainstem?.orienting).toMatchObject({ proposed: false });
    expect(out.candidates.some((c) => "skill" in c.action && c.action.skill === "look_at")).toBe(false);
  });

  it("orienting never takes over from a running skill other than idle", async () => {
    const { tick } = bot();
    await tick({}, "go_to");
    const out = await tick({ mobs: [mob("zombie", 12)] }, "go_to");
    expect(out.candidates.some((c) => c.region === "brainstem")).toBe(false);
    expect(out.won).toBe("go_to");
  });

  it("lava, fire and low air each fire their hard reflex and win outright", async () => {
    const cases: [Patch, string][] = [
      [{ self: { inLava: true } }, "escape_hazard"],
      [{ self: { onFire: true } }, "escape_hazard"],
      [{ self: { inWater: true, air: 5 } }, "surface"],
    ];
    for (const [patch, expected] of cases) {
      const { tick } = bot();
      await tick();
      expect((await tick(patch)).winner).toMatchObject({ region: "reflex", urgency: 1, action: { skill: expected } });
    }
  });
});

describe("startle", () => {
  it("fires once when a hostile appears on top of the bot, raises alarm, and not again within 5 seconds", async () => {
    const withStartle = bot();
    const without = bot({ brainstem: { startle: 0 } });
    for (const b of [withStartle, without]) await b.tick();
    const ambush = { mobs: [mob("zombie", 2)] };
    const out = await withStartle.tick(ambush);
    await without.tick(ambush);
    expect(withStartle.value("startle")).toBe(1);
    expect(out.winner).toMatchObject({ region: "brainstem", action: { skill: "brace", target: "entity:1" }, urgency: 1 });
    expect(out.traces.noradrenaline?.raisedBy).toMatchObject({ startle: 0.3, hostile_appeared: 0.6 });
    expect(withStartle.value("alarm")).toBeGreaterThan(without.value("alarm")!);

    // A second mob up close a second later does not startle again; one six seconds later does.
    await withStartle.tick({ mobs: [mob("zombie", 2), mob("zombie", 2, 2)] }, null, 1000);
    expect(withStartle.value("startle")).toBe(0);
    await withStartle.tick({ mobs: [mob("zombie", 2), mob("zombie", 2, 2), mob("zombie", 2, 3)] }, null, 5000);
    expect(withStartle.value("startle")).toBe(1);
  });

  it("a hit from something unseen startles and turns the bot toward it", async () => {
    const { tick, value } = bot();
    await tick();
    const out = await tick({ self: { health: 17, lastHurt: { msAgo: 20, by: "entity:9" } }, mobs: [{ ...mob("skeleton", 20, 9) }] });
    expect(value("startle")).toBe(1);
    expect(out.traces.brainstem?.startle).toEqual({ by: "hurt_unseen", source: { id: "entity:9", kind: "skeleton" } });
  });
});

describe("loaded responses", () => {
  it("fire when the thing appears, before the planner is asked again, and stop when the goal changes", async () => {
    const { store, tick, calls } = bot();
    await tick();
    store.viewFor("prefrontal").setGoal({ text: "Explore", steps: [], reason: "", ifThen: [{ when: "creeper", skill: "flee" }, { when: "creeper", skill: "escape_hazard" }, { when: "cow", skill: "brace" }] });
    const plansBefore = calls.planner;
    const quiet = await tick();
    // A reflex-only skill and a primitive may not be loaded: both are dropped, and logged.
    expect(quiet.traces.brainstem?.droppedResponses).toEqual([
      { rule: { when: "creeper", skill: "escape_hazard" }, why: "reflex-only skill" },
      { rule: { when: "cow", skill: "brace" }, why: "a primitive, not a skill" },
    ]);
    store.viewFor("prefrontal").setGoal({ text: "Explore", steps: [], reason: "", ifThen: [{ when: "creeper", skill: "flee" }] });
    const out = await tick({ mobs: [mob("creeper", 12)] });
    expect(out.winner).toMatchObject({ region: "brainstem", action: { skill: "flee", target: "entity:1" }, urgency: 0.95 });
    expect(out.reflexes).toEqual([]); // 12 blocks is far: no reflex spoke
    expect(calls.planner - plansBefore).toBeLessThanOrEqual(2); // the fake planner runs every tick here; the point is the response needed no new plan

    store.viewFor("prefrontal").setGoal({ text: "Go home", steps: [], reason: "" });
    const later = await tick({ mobs: [mob("creeper", 12), mob("creeper", 12, 2)] }, null, 10_000);
    expect(later.candidates.some((c) => c.reason.startsWith("loaded response"))).toBe(false);
  });
});

describe("arousal gate", () => {
  const inBed = { night: true, self: { asleep: true } };

  it("asleep and calm: no engine or planner calls; reflexes, dials and memory keep running", async () => {
    const { tick, calls, value } = bot();
    await tick(inBed, "sleep");
    const before = { ...calls };
    for (let i = 0; i < 20; i++) {
      const out = await tick(inBed, "sleep");
      expect(out.won).toBe("sleep");
      expect(out.traces.instinct).toEqual({ paused: true });
      expect(out.traces.prefrontal).toEqual({ paused: true });
      // The gate never touches the layers below it.
      for (const region of ["reflex", "dopamine", "serotonin", "noradrenaline", "acetylcholine", "hippocampus"]) expect(Object.keys(out.traces)).toContain(region);
    }
    expect(calls.engine).toBe(before.engine);
    expect(calls.planner).toBe(before.planner);
    expect(value("upper_paused")).toBe(1);
    expect(value("arousal")).toBeCloseTo(0.05);
  });

  it("damage resumes instinct and the planner on the same tick", async () => {
    const { tick, calls, value } = bot();
    await tick(inBed, "sleep");
    await tick(inBed, "sleep");
    const before = { ...calls };
    const out = await tick({ night: true, self: { asleep: true, health: 17 } }, "sleep");
    expect(value("upper_paused")).toBe(0);
    expect(calls.engine).toBe(before.engine + 1);
    expect(calls.planner).toBe(before.planner + 1);
    expect(out.traces.brainstem?.woken).toBe("damage");
  });

  it("a hard reflex wakes it too", async () => {
    const { tick, value } = bot();
    await tick(inBed, "sleep");
    await tick(inBed, "sleep");
    const out = await tick({ night: true, self: { asleep: true, onFire: true } }, "sleep");
    expect(value("upper_paused")).toBe(0);
    expect(out.won).toBe("escape_hazard");
  });
});

describe("with the engine failing every call", () => {
  it("an ambush is still survived by reflexes alone", async () => {
    const { tick, calls } = bot({ engineFails: true });
    await tick();
    // A crude world: fleeing opens the gap by 2 blocks a tick; otherwise the zombie closes in and hits within 2.
    let [dist, health, running]: [number, number, string | null] = [2, 20, null];
    const wins: string[] = [];
    for (let i = 0; i < 30 && dist <= 8 && health > 0; i++) {
      const out = await tick({ self: { health }, mobs: [mob("zombie", dist)] }, running);
      expect(out.errors).toEqual(["instinct"]);
      expect(out.winner?.region === "reflex" || out.winner?.region === "brainstem").toBe(true);
      wins.push(out.won ?? "nothing");
      running = out.won;
      if (out.won === "flee") dist += 2;
      else {
        dist = Math.max(1, dist - 1);
        if (dist <= 2) health -= 3;
      }
    }
    expect(calls.engine).toBeGreaterThan(0);
    expect(health).toBeGreaterThan(0);
    expect(dist).toBeGreaterThanOrEqual(9); // out of reach of the defence reflexes: no longer a threat
    expect(wins.filter((w) => w === "flee").length).toBeGreaterThan(2);
  });
});

describe("with every brainstem strength at 0", () => {
  it("decisions match a brain with the brainstem lesioned", async () => {
    const off = bot({ brainstem: ALL_OFF });
    const lesioned = bot({ only: ["reflex", "acetylcholine", "dopamine", "noradrenaline", "hippocampus", "instinct", "serotonin", "prefrontal"] });
    const script: [Patch, string | null][] = [
      [{}, null],
      [{ mobs: [mob("zombie", 12)] }, "idle"],
      [{ mobs: [mob("zombie", 6)] }, "idle"],
      [{ mobs: [mob("zombie", 2)] }, "flee"],
      [{ self: { health: 14, bestWeapon: "stone_sword" }, mobs: [mob("zombie", 2)] }, "flee"],
      [{ self: { health: 5 }, mobs: [mob("zombie", 3)] }, "attack"],
      [{ self: { food: 4, foodItems: 2 } }, "idle"],
      [{ night: true, self: { asleep: true } }, "sleep"],
      [{ night: true, self: { asleep: true, health: 15 } }, "sleep"],
      [{ self: { inLava: true } }, "idle"],
    ];
    for (const [patch, running] of script) {
      const [a, b] = [await off.tick(patch, running), await lesioned.tick(patch, running)];
      expect(a.winner).toEqual(b.winner);
      // Every soft reflex fires at exactly the urgency its rule wrote: gain 1.
      for (const r of a.reflexes) expect(r.gain).toBe(1);
      expect(a.reflexes).toEqual(b.reflexes);
    }
    expect(off.value("upper_paused")).toBeUndefined();
    expect(off.calls.engine).toBe(lesioned.calls.engine);
  });
});

describe("the decision menu", () => {
  it("never offers reflex-only skills, and primitives only when asked", async () => {
    const { tick, calls } = bot();
    await tick();
    expect(calls.menus.at(-1)).toEqual(["go_to", "idle", "eat", "flee", "sleep", "attack"]);
  });
});
