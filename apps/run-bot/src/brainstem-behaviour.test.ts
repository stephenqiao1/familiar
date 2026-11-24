// Behaviour tests for the spinal cord and brainstem layer, run through the bot's real wiring:
// createBrain (every region, the player's reflexes and brainstem settings) and the arbiter.
// Only the world, the engine and the planner are made up.

import type { Answer, Candidate, DecisionEngine, Plan, Planner, Question, Skill, State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { createMemory } from "@familiar/memory";
import { createChestMemory, DEFAULT_DEFENCE, SCHEMA_VERSION, type DefenceSettings, type MinecraftStateData } from "@familiar/minecraft";
import {
  createNoveltyMemory,
  createPersistence,
  createScorebook,
  DEFAULT_FOCUS,
  DEFAULT_NORADRENALINE,
  DEFAULT_PATIENCE,
  DEFAULT_PERSONALITY,
} from "@familiar/neuromodulators";
import { DEFAULT_AROUSAL, DEFAULT_BRAINSTEM, DEFAULT_COLLICULUS, type ArousalSettings, type BrainstemSettings, type ColliculusSettings } from "@familiar/region-brainstem";
import { DEFAULT_DRIVES, DRIVES_OFF, type DriveSettings } from "@familiar/region-hypothalamus";
import type { FiredReflex } from "@familiar/region-reflex";
import { describe, expect, it } from "vitest";
import { createArbiter, createBrain } from "./brain.js";

const signal = new AbortController().signal;
const ALL_OFF: BrainstemSettings = { bravery: 0.5, gains: 0, startle: 0, potentiation: 0, warning: 0, habituation: 0, selfCaused: 0, startReact: 0, loadedResponses: 0, holdBack: 0, arousalStartle: 0, bodySignals: 0 };
const AROUSAL_OFF: ArousalSettings = { resting: 0.5, sleepPressure: 0, bedtime: 0, wakeThreshold: 0.5, inertia: 0, gate: 0, quietRest: 0, frazzled: 0, stress: 0, orienting: 0 };
type Mob = MinecraftStateData["nearby"]["mobs"][number];
const mob = (type: string, dist: number, id = 1): Mob => ({ id: `entity:${id}`, type, dist, hostile: true, reachable: true });

type Near = MinecraftStateData["nearby"];
type Patch = { self?: Partial<MinecraftStateData["self"]>; mobs?: Mob[]; night?: boolean; sudden?: Near["sudden"]; heard?: Near["heard"] };
const LEFT = { side: "left" as const, angle: 60 };
/** A mob that has just come into view: on the list, and among the things that suddenly changed. */
const appears = (m: Mob, what: Near["sudden"][number]["what"] = "appeared"): Patch => ({ mobs: [m], sudden: [{ id: m.id, what, bearing: LEFT, dist: m.dist }] });

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
      badFoodItems: 0,
      saturation: 5,
      effects: [],
      freezing: 0,
      sinceSleepMinutes: 0,
      healing: false,
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
      touching: { feet: "air", head: "air", below: "stone", sides: ["air", "air", "air", "air"] },
      inBlock: false,
      pushed: null,
      motion: null,
      support: { on: "stone", kind: "solid", edges: 0, headroom: 3 },
      velocity: { x: 0, y: 0, z: 0, onGround: true },
      landing: null,
      displaced: false,
      balance: 1,
      gaze: { id: null, yaw: 0 },
      locomotion: { moving: false, pattern: null, gait: "walk", stuck: false },
      ...p.self,
    },
    nearby: { hazards: [], mobs: p.mobs ?? [], blocks: [], players: [], sudden: p.sudden ?? [], heard: p.heard ?? [] },
    memory: null,
    current: null,
  };
  return { schemaVersion: SCHEMA_VERSION, tick: 0, timestamp: ms, data: { ...data } };
}

const skill = (name: string, flags: Partial<Skill<null>> = {}): Skill<null> => ({ name, description: name, canRun: () => true, run: async () => ({ status: "done" }), ...flags });
const skills = [
  ...["go_to", "idle", "flee", "sleep", "consume"].map((name) => skill(name)),
  skill("eat", { parts: ["hands"] }),
  skill("attack", { risky: true }),
  skill("escape_hazard", { reflexOnly: true }),
  skill("surface", { reflexOnly: true }),
  skill("freeze", { reflexOnly: true }),
  skill("recuperate", { reflexOnly: true }),
  skill("look_at", { primitive: true }),
  skill("brace", { primitive: true }),
];

/** The whole brain on one workspace, one tick at a time. The engine prefers the running skill, else idles. */
function bot(options: { brainstem?: Partial<BrainstemSettings>; colliculus?: Partial<ColliculusSettings>; defence?: Partial<DefenceSettings>; arousal?: Partial<ArousalSettings>; drives?: DriveSettings; only?: string[]; spread?: Record<string, number>; engineFails?: boolean; plan?: Plan; sameTime?: boolean } = {}) {
  const store = createWorkspace();
  const calls = { engine: 0, planner: 0, menus: [] as string[][], shown: [] as State[] };
  const engine: DecisionEngine = {
    name: "fake",
    async decide(_state, questions: Question[]): Promise<Answer[]> {
      calls.engine++;
      if (options.engineFails) throw new Error("engine down");
      const next = questions.find((q) => q.kind === "choice" && q.id === "next_action");
      if (next?.kind !== "choice") return [];
      calls.menus.push(next.options);
      calls.shown.push(_state);
      const choice = store.viewFor("x").current?.skill ?? "idle";
      // `spread`: an engine in two or three minds, to show how many options get proposed.
      return [{ kind: "choice", id: "next_action", choice, probabilities: options.spread ?? { [choice]: 0.9 }, confidence: 0.9 }];
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
      colliculus: { ...DEFAULT_COLLICULUS, ...options.colliculus },
      defence: { ...DEFAULT_DEFENCE, ...options.defence },
      arousal: { ...DEFAULT_AROUSAL, ...options.arousal },
      ...(options.drives ? { drives: options.drives } : {}),
      sameTime: options.sameTime ?? false,
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
  it("a new threat's first tick is not damped: the gain uses this tick's threat, then alarm once it has risen", async () => {
    const { tick } = bot();
    await tick();
    const first = await tick({ mobs: [mob("zombie", 6)] });
    expect(first.reflexes).toMatchObject([{ rule: "defence_flee", kind: "soft", skill: "flee", base: 0.7 }]);
    // Alarm was still 0 when the reflex fired, but the threat is coming (0.8): 0.6 + 0.8 × 0.8.
    expect(first.reflexes[0]!.gain).toBeCloseTo(1.24);
    expect(first.reflexes[0]!.urgency).toBeGreaterThan(0.7);
    const second = await tick({ mobs: [mob("zombie", 6)] });
    expect(second.reflexes[0]!.gain).toBeGreaterThan(1);
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
    // The goal comes from the planner: now that a close ambush no longer takes it offline, it would replace one set by hand.
    const held = bot({ plan: { goal: "Stand and fight", steps: [], reason: "", holdBack: ["flee"] } });
    for (const b of [free, held]) await b.tick();
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
    const { store, tick, value } = bot();
    await tick({}, "idle");
    const out = await tick(appears(mob("zombie", 12)), "idle");
    expect(out.reflexes).toEqual([]);
    expect(value("orienting")).toBeGreaterThan(0.5);
    expect(out.winner).toMatchObject({ region: "colliculus", action: { skill: "look_at", target: "entity:1" } });
    expect(store.attended()).toMatchObject({ id: "entity:1", kind: "zombie", bearing: "ahead" });
    expect(out.candidates.some((c) => "skill" in c.action && c.action.skill === "flee")).toBe(false);
  });

  it("a look never takes over from a reflex: a threat that appears close gets the reflex, and the look only competes", async () => {
    const { tick } = bot({ brainstem: { startle: 0 } });
    await tick({}, "idle");
    const out = await tick(appears(mob("zombie", 6)), "idle");
    expect(out.traces.colliculus?.look).toMatchObject({ how: "competes" });
    expect(out.won).not.toBe("look_at");
  });

  it("a look never takes over from a running skill other than idle: it competes, weakly", async () => {
    const { tick } = bot();
    await tick({}, "go_to");
    const out = await tick(appears(mob("zombie", 12)), "go_to");
    expect(out.candidates.find((c) => c.region === "colliculus")?.urgency).toBeLessThan(0.7);
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
  const ambush = { mobs: [mob("zombie", 2)] };
  const bangAt = (loudness: number) => ({ heard: [{ type: "explosion", bearing: { side: "behind" as const, angle: 180 }, dist: 9, position: { x: 0, y: 63, z: 9 }, loudness, msAgo: 30 }] });

  it("a hostile appearing on top of the bot: a full startle, sized, braced toward it", async () => {
    const { tick, value } = bot();
    await tick();
    const out = await tick(ambush);
    expect(value("startle")).toBeCloseTo(0.62, 1);
    expect(out.winner).toMatchObject({ region: "brainstem", action: { skill: "brace", target: "entity:1" }, urgency: 1 });
    expect(out.traces.brainstem?.startle).toMatchObject({ by: "hostile_up_close", size: "full", cause: "hostile_appeared", potentiation: 1, warning: 0, habituated: 0 });
    // Not again within a second, whatever turns up.
    await tick({ mobs: [mob("zombie", 2), mob("zombie", 1, 2)] }, null, 400);
    expect(value("startle")).toBe(0);
  });

  it("alarm takes the larger of the startle and its cause, not the sum: the startle adds nothing to an ambush", async () => {
    const withStartle = bot();
    const without = bot({ brainstem: { startle: 0 } });
    for (const b of [withStartle, without]) await b.tick();
    const out = await withStartle.tick(ambush);
    await without.tick(ambush);
    // 0.4 × 0.62 is less than what the danger's own jump already gave: the startle adds nothing on top.
    expect(out.traces.noradrenaline?.raisedBy).toEqual({ danger: expect.any(Number) });
    expect(withStartle.value("alarm")).toBeGreaterThan(0.8); // a zombie two blocks off is nearly as pressing as danger gets
    expect(withStartle.value("alarm")).toBe(without.value("alarm"));
  });

  it("a bang (nothing else set off by it) raises alarm by 0.4 × its size; with a mob appearing too, the larger of the two counts", async () => {
    const { tick, value } = bot();
    await tick();
    const out = await tick(bangAt(0.9));
    expect(out.traces.noradrenaline?.raisedBy).toEqual({ startle: expect.closeTo(0.36) });
    // A bang while a mob also appears close: alarm goes by the larger, the danger.
    const both = bot();
    await both.tick();
    const two = await both.tick({ ...bangAt(0.9), mobs: [mob("zombie", 6)] });
    expect(two.traces.brainstem?.startle).toMatchObject({ by: "loud_nearby" });
    expect(two.traces.noradrenaline?.raisedBy).toEqual({ danger: expect.any(Number) });
    expect(both.value("alarm")).toBeGreaterThan(0.36);
    expect(value("alarm")).toBeCloseTo(0.36);
  });

  it("a hit from something unseen startles and turns the bot toward it; its alarm is the larger of the hit and the startle", async () => {
    const { tick, value } = bot();
    await tick();
    const out = await tick({ self: { health: 17, lastHurt: { msAgo: 20, by: "entity:9", kind: "mob_attack", at: { x: 0, y: 63, z: 0 } } }, mobs: [{ ...mob("skeleton", 20, 9) }] });
    expect(value("startle")).toBeCloseTo(0.67);
    expect(out.traces.brainstem?.startle).toMatchObject({ by: "hurt_unseen", source: { id: "entity:9", kind: "skeleton" }, size: "full", cause: "damage" });
    expect(out.winner).toMatchObject({ action: { skill: "brace", target: "entity:9" } });
    // Three points of health is a small worsening (0.15); the startle (0.4 × 0.67) is the larger.
    expect(out.traces.noradrenaline?.raisedBy).toEqual({ health: expect.closeTo(0.15), startle: expect.closeTo(0.27, 1) });
    expect(value("alarm")).toBeCloseTo(0.27, 1);
  });

  it("a mild bang is a flinch, proposed below urgency 1, toward where it came from", async () => {
    const { tick, value } = bot();
    await tick({}, "go_to");
    const out = await tick(bangAt(0.45), "go_to");
    expect(value("startle")).toBeCloseTo(0.45);
    expect(out.candidates).toContainEqual(expect.objectContaining({ region: "brainstem", action: { skill: "flinch", target: "pos:0,63,9" }, urgency: 0.9 }));
    expect(out.traces.brainstem?.startle).toMatchObject({ size: "flinch" });
  });

  it("is bigger in the dark just after being hurt than when calm", async () => {
    const calm = bot();
    await calm.tick();
    await calm.tick(bangAt(0.5));
    const edgy = bot();
    await edgy.tick();
    await edgy.tick({ night: true, self: { health: 12 } }); // hurt: alarm is up
    const out = await edgy.tick({ night: true, self: { health: 12 }, ...bangAt(0.5) });
    expect(calm.value("startle")).toBeCloseTo(0.5);
    expect(edgy.value("startle")!).toBeGreaterThan(0.6);
    expect((out.traces.brainstem?.startle as { potentiation: number }).potentiation).toBeGreaterThan(1.2);
  });

  it("the same bang again and again startles less each time, down to nothing", async () => {
    const { tick, value } = bot();
    await tick();
    const sizes: number[] = [];
    for (let i = 0; i < 4; i++) {
      await tick(bangAt(0.9), null, 2500);
      sizes.push(value("startle")!);
      await tick({}, null, 2500);
    }
    expect(sizes[0]).toBeCloseTo(0.9);
    expect(sizes[1]).toBeLessThan(sizes[0]!);
    expect(sizes[2]).toBeLessThan(sizes[1]!);
    expect(sizes[3]).toBe(0);
  });

  it("hunger ticks startle at most the first time, with no special case for them", async () => {
    const { tick } = bot();
    await tick();
    const flinched: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      const out = await tick({ self: { health: 19 - i, food: 0, lastHurt: { msAgo: 20, by: null, kind: "starve", at: { x: 0, y: 63, z: 0 } } } }, null, 500);
      flinched.push(out.traces.brainstem?.startle !== undefined);
      await tick({ self: { health: 19 - i, food: 0, lastHurt: { msAgo: 3500, by: null, kind: "starve", at: { x: 0, y: 63, z: 0 } } } }, null, 3500);
    }
    expect(flinched.filter(Boolean).length).toBeLessThanOrEqual(1);
    expect(flinched[0]).toBe(true);
  });

  it("a goal's onStartle response is released by a full startle from something unrelated, in place of the brace", async () => {
    const { tick } = bot({ plan: { goal: "Hold the line", steps: [], reason: "", ifThen: [{ when: "creeper", skill: "flee", onStartle: true }] } });
    await tick();
    await tick();
    // Something to flee from must be there for the skill to be aimed; the bang is what sets it off.
    const out = await tick({ ...bangAt(0.9), mobs: [mob("zombie", 12)] });
    expect(out.traces.brainstem?.startle).toMatchObject({ by: "loud_nearby", size: "full", released: "flee" });
    expect(out.winner).toMatchObject({ region: "brainstem", action: { skill: "flee" }, urgency: 1 });
    expect(out.candidates.some((c) => "skill" in c.action && c.action.skill === "brace")).toBe(false);
  });

  it("brainstem.startle at 0 gives no startles; at 1.5 gives larger ones", async () => {
    const off = bot({ brainstem: { startle: 0 } });
    await off.tick();
    const none = await off.tick(bangAt(1));
    expect(none.traces.brainstem?.startle).toBeUndefined();
    expect(none.candidates.some((c) => c.region === "brainstem")).toBe(false);
    const jumpy = bot({ brainstem: { startle: 1.5 } });
    await jumpy.tick();
    await jumpy.tick(bangAt(0.5));
    expect(jumpy.value("startle")).toBeCloseTo(0.75);
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

describe("the reticular formation through the real brain", () => {
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
    expect(value("arousal")).toBeLessThan(0.15);
    expect(value("upper_rate")).toBe(0);
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
    expect(out.traces.reticular?.waking).toMatchObject({ by: "a hurt", calm: false });
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
    const off = bot({ brainstem: ALL_OFF, arousal: AROUSAL_OFF });
    const lesioned = bot({ only: ["reflex", "medulla", "acetylcholine", "dopamine", "noradrenaline", "hippocampus", "instinct", "serotonin", "prefrontal"] });
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
    expect(off.value("upper_paused")).toBe(0);
    expect(off.calls.engine).toBe(lesioned.calls.engine);
  });
});

describe("the decision menu", () => {
  it("never offers reflex-only skills, and primitives only when asked", async () => {
    const { tick, calls } = bot();
    await tick();
    expect(calls.menus.at(-1)).toEqual(["go_to", "idle", "flee", "sleep", "consume", "eat", "attack"]);
  });
});

describe("looking while the hands are busy (the same-time flag)", () => {
  const how = (out: { traces: Record<string, Record<string, unknown>> }) => (out.traces.colliculus?.look as { how: string } | undefined)?.how;

  it("off: a look only competes while a skill other than idle runs", async () => {
    const { tick } = bot();
    await tick({}, "eat");
    expect(how(await tick(appears(mob("zombie", 12)), "eat"))).toBe("competes");
  });

  it("on: a look runs alongside eating (hands only), but only competes with a whole-body skill", async () => {
    const eating = bot({ sameTime: true });
    await eating.tick({}, "eat");
    const out = await eating.tick(appears(mob("zombie", 12)), "eat");
    expect(out.candidates).toContainEqual(expect.objectContaining({ region: "colliculus", action: { skill: "look_at", target: "entity:1" } }));
    expect(how(out)).toBe("alongside");
    const walking = bot({ sameTime: true });
    await walking.tick({}, "go_to");
    expect(how(await walking.tick(appears(mob("zombie", 12)), "go_to"))).toBe("competes");
  });

  it("is still proposed alongside when the urge that fired runs a skill that leaves the head free", async () => {
    const starving = { self: { food: 4, foodItems: 3 } };
    const eating = bot({ sameTime: true });
    await eating.tick(starving, "eat");
    const out = await eating.tick({ ...starving, ...appears(mob("zombie", 12)) }, "eat");
    expect((out.traces.medulla?.urges as { rule: string }[]).map((r) => r.rule)).toEqual(["eat_when_starving"]);
    expect(how(out)).toBe("alongside");
  });

  it("on: a look runs alongside a walking skill, since walking leaves the head free", async () => {
    const walk = skill("walk", { parts: ["legs", "hands"] });
    skills.push(walk);
    try {
      const walking = bot({ sameTime: true });
      await walking.tick({}, "walk");
      expect(how(await walking.tick(appears(mob("zombie", 12)), "walk"))).toBe("alongside");
    } finally {
      skills.pop();
    }
  });

  it("a skill that uses no part of the body (idling) always has looks beside it, flag or not", async () => {
    const still = skill("stand", { parts: [] });
    skills.push(still);
    try {
      const { tick } = bot();
      await tick({}, "stand");
      expect(how(await tick(appears(mob("zombie", 12)), "stand"))).toBe("alongside");
    } finally {
      skills.pop();
    }
  });
});

describe("the colliculus through the real brain", () => {
  const BEHIND = { side: "behind" as const, angle: 180 };
  const bang = { type: "explosion", bearing: BEHIND, dist: 9, position: { x: 0, y: 63, z: 9 }, loudness: 0.75 };

  it("startle braces toward where the bang came from", async () => {
    const { tick } = bot();
    await tick();
    const out = await tick({ heard: [bang] });
    expect(out.winner).toMatchObject({ region: "brainstem", action: { skill: "brace", target: "pos:0,63,9" } });
    // The look does not take over on the tick the startle spoke; the map still has the bang on top.
    expect(out.traces.colliculus?.winner).toMatchObject({ id: "pos:0,63,9", via: "sound" });
  });

  it("looming makes a far thing count as coming in the defence reflexes, and raises alarm through the startle", async () => {
    const { tick, value } = bot({ brainstem: { startle: 0 } });
    await tick({ mobs: [mob("skeleton", 14)] });
    expect(value("alarm")).toBeCloseTo(0.125); // a skeleton far off, aware of the bot, presses a little
    const calm = await tick({ mobs: [mob("skeleton", 14)] });
    expect(calm.reflexes).toEqual([]);
    // An arrow heading this way: the far skeleton is now something to get away from.
    const arrow = { id: "entity:9", what: "looming" as const, bearing: LEFT, dist: 12 };
    const out = await tick({ mobs: [mob("skeleton", 14)], sudden: [arrow] });
    expect(value("looming")).toBe(1);
    // With the startle on (as it is by default), the arrow's startle raises alarm at once.
    const startled = bot();
    await startled.tick({ mobs: [mob("skeleton", 14)] });
    await startled.tick({ mobs: [mob("skeleton", 14)], sudden: [arrow] });
    expect(startled.value("alarm")).toBeGreaterThan(value("alarm")! + 0.1);
    expect(out.reflexes).toMatchObject([{ rule: "defence_flee", skill: "flee" }]);
    expect(out.candidates).toContainEqual(expect.objectContaining({ region: "reflex", action: { skill: "flee", target: "entity:1" } }));
    expect(out.traces.colliculus?.winner).toMatchObject({ id: "entity:9", why: "sight: looming" });
  });

  it("with looming switched off, the colliculus shares no looming; the defence circuit still retreats from what is coming fast", async () => {
    const { tick, value } = bot({ brainstem: { startle: 0 }, colliculus: { looming: 0 } });
    await tick({ mobs: [mob("skeleton", 14)] });
    const out = await tick({ mobs: [mob("skeleton", 14)], sudden: [{ id: "entity:9", what: "looming", bearing: LEFT, dist: 12 }] });
    expect(value("looming")).toBeUndefined();
    expect(out.reflexes).toMatchObject([{ rule: "defence_flee" }]);
  });

  it("with the colliculus region off: no looks are proposed, attended stays null, and everything else runs", async () => {
    const only = ["reflex", "medulla", "brainstem", "acetylcholine", "dopamine", "noradrenaline", "hippocampus", "instinct", "serotonin", "prefrontal"];
    const { store, tick, value } = bot({ only });
    await tick({}, "idle");
    const out = await tick({ ...appears(mob("zombie", 12)), heard: [bang] }, "idle");
    expect(out.candidates.some((c) => "skill" in c.action && c.action.skill === "look_at")).toBe(false);
    expect(store.attended()).toBeNull();
    expect(value("orienting")).toBeUndefined();
    expect(out.errors).toEqual([]);
    // Startle, the reflexes and Jev are all still there.
    expect(out.winner).toMatchObject({ region: "brainstem", action: { skill: "brace" } });
    const close = await tick({ mobs: [mob("zombie", 6)] }, "idle");
    expect(close.reflexes.map((r) => r.rule)).toEqual(["defence_flee"]);
  });

  describe("with the field of view on", () => {
    const seen = (m: Mob, yes: boolean): Mob => ({ ...m, seen: yes, bearing: yes ? LEFT : BEHIND, closing: 0 });
    const toldOf = (state: State | undefined) => (state?.data as unknown as MinecraftStateData).nearby.mobs;

    it("a thing behind and silent is not reported to the deciding layers; the reflexes still feel the real world", async () => {
      const { tick, calls } = bot({ colliculus: { fieldOfView: 1 } });
      await tick();
      const cow = { ...seen(mob("cow", 12, 2), false), hostile: false };
      const out = await tick({ mobs: [cow, seen(mob("zombie", 10, 3), true)] });
      expect(toldOf(calls.shown.at(-1)).map((m) => m.id)).toEqual(["entity:3"]);
      // The planner is told the same.
      expect(out.errors).toEqual([]);
      // Off: everything within range is told, as before.
      const all = bot();
      await all.tick({ mobs: [cow] });
      expect(toldOf(all.calls.shown.at(-1)).map((m) => m.id)).toEqual(["entity:2"]);
    });

    it("it is reported once heard or looked at, and stays known for about 10 seconds after it leaves view", async () => {
      const { tick, calls } = bot({ colliculus: { fieldOfView: 1 } });
      const zombie = mob("zombie", 12);
      await tick({ mobs: [seen(zombie, false)] });
      expect(toldOf(calls.shown.at(-1))).toEqual([]);
      // Looked at: in view now.
      await tick({ mobs: [seen(zombie, true)] });
      expect(toldOf(calls.shown.at(-1)).map((m) => m.id)).toEqual(["entity:1"]);
      // Out of view again: remembered, marked with how long ago and where.
      await tick({ mobs: [seen(zombie, false)] }, null, 4000);
      expect(toldOf(calls.shown.at(-1))).toMatchObject([{ id: "entity:1", seen: false, lastSeen: { msAgo: 4000 } }]);
      await tick({ mobs: [seen(zombie, false)] }, null, 7000);
      expect(toldOf(calls.shown.at(-1))).toEqual([]);
      // Heard: a sound from where it stands (behind, 12 blocks) makes it known again.
      await tick({ mobs: [seen(zombie, false)], heard: [{ type: "sound", bearing: BEHIND, dist: 12, position: { x: 0, y: 63, z: 12 }, loudness: 0.3 }] });
      expect(toldOf(calls.shown.at(-1)).map((m) => m.id)).toEqual(["entity:1"]);
    });

    it("anything within 2 blocks is felt, seen or not", async () => {
      const { tick, calls } = bot({ colliculus: { fieldOfView: 1 } });
      await tick({ mobs: [seen(mob("zombie", 2), false)] });
      expect(toldOf(calls.shown.at(-1)).map((m) => m.id)).toEqual(["entity:1"]);
    });
  });
});

describe("balance and posture through the real brain", () => {
  const ledge = { support: { on: "stone", kind: "solid" as const, edges: 2, headroom: 3 }, balance: 0.5 };
  const pushedToDrop = { pushed: { blocks: 1, toward: { x: 0, z: -1 }, danger: { what: "drop", blocks: 1 } } };

  it("shares unsteady (1 − balance) and traces what holds the bot up", async () => {
    const { tick, value } = bot();
    await tick();
    expect(value("unsteady")).toBe(0);
    const out = await tick({ self: ledge });
    expect(value("unsteady")).toBe(0.5);
    expect(out.traces.brainstem?.posture).toMatchObject({ support: { kind: "solid", edges: 2 }, balance: 0.5 });
  });

  it("falling toward a landing that would hurt, with a better one in reach: the righting reflex wins outright", async () => {
    const { tick } = bot();
    await tick();
    const out = await tick({ self: { landing: { blocks: 8, onto: "stone", hurts: true, steer: "pos:1,64,0" }, balance: 0 } });
    expect(out.winner).toMatchObject({ region: "reflex", action: { skill: "air_steer", target: "pos:1,64,0" }, urgency: 1 });
    // With nothing better in reach nothing fires: there is nothing a body can do.
    const none = await tick({ self: { landing: { blocks: 8, onto: "stone", hurts: true, steer: null }, balance: 0 } });
    expect(none.reflexes.map((r) => r.rule)).not.toContain("falling_right");
    expect(none.traces.brainstem?.posture).toMatchObject({ landing: { hurts: true, steer: null } });
  });

  it("moved somewhere else: the planner is asked to plan again, and it is not taken for a push", async () => {
    const { tick, value } = bot();
    await tick();
    const pushed = await tick({ self: pushedToDrop });
    expect(pushed.reflexes.map((r) => r.rule)).toContain("hold_ground");
    expect(value("replan")).toBe(0);
    const moved = await tick({ self: { ...pushedToDrop, displaced: true } });
    expect(moved.reflexes.map((r) => r.rule)).not.toContain("hold_ground");
    expect(value("replan")).toBe(1);
    expect(moved.traces.brainstem?.posture).toMatchObject({ displaced: true });
    await tick();
    expect(value("replan")).toBe(0);
  });
});

describe("the medulla through the real brain", () => {
  const VITAL_SIGNS = ["air", "hunger", "pain", "hurt", "sick", "cold", "tired", "reserve", "vitals"];
  const WITHOUT_MEDULLA = ["reflex", "brainstem", "acetylcholine", "dopamine", "noradrenaline", "hippocampus", "instinct", "serotonin", "prefrontal"];
  const diving = (air: number) => ({ self: { inWater: true, air } });

  it("shares the vital signs every tick", async () => {
    const { tick, value } = bot();
    await tick({ self: { health: 10, food: 5, air: 14, effects: ["poison"], sinceSleepMinutes: 2160, saturation: 0 } });
    expect([value("hurt"), value("hunger"), value("air"), value("sick"), value("tired"), value("reserve")]).toEqual([0.5, 0.75, expect.closeTo(0.3), 1, 0.5, 0]);
    expect(value("vitals")).toBeLessThan(0.15); // poisoned: the worst reading decides it
  });

  it("the urge to breathe grows with the need, and surfaces the bot before the hard limit", async () => {
    const { tick } = bot();
    await tick(diving(20));
    expect((await tick(diving(13))).candidates.some((c) => c.region === "medulla")).toBe(false);
    // The engine here is very sure of itself (0.72), so the urge has to grow before it wins: it is soft.
    const early = await tick(diving(11));
    expect(early.candidates).toContainEqual(expect.objectContaining({ region: "medulla", action: { skill: "surface" }, urgency: expect.closeTo(0.42) }));
    expect(early.won).toBe("idle");
    const out = await tick(diving(8));
    expect(out.winner).toMatchObject({ region: "medulla", action: { skill: "surface" } });
    expect(out.winner!.urgency).toBeLessThan(1);
  });

  it("an upkeep urge is no weaker for being calm: alarm does not scale it", async () => {
    const { tick, value } = bot();
    await tick(diving(20));
    const out = await tick(diving(10));
    expect(value("alarm")).toBe(0);
    expect(out.traces.medulla?.urges).toMatchObject([{ rule: "need_air", base: expect.closeTo(0.54), gain: 1 }]);
  });

  it("you can hold your breath, but not forever: a goal holds the urge back, then drowning takes over at 6", async () => {
    // The planner's goal holds the urge back (and asks for the hard reflex too, which is ignored).
    const { tick } = bot({ plan: { goal: "Dive to the bottom and stay there", steps: [], reason: "", holdBack: ["need_air", "drowning"] } });
    await tick(diving(20), "go_to");
    for (const air of [12, 10, 8, 7]) {
      const out = await tick(diving(air), "go_to");
      const urge = out.candidates.find((c) => c.region === "medulla");
      expect(urge!.urgency, `air ${air}`).toBeLessThan(0.3); // held back to 0.3 of its gain
      expect(out.won, `air ${air}`).toBe("go_to"); // it stays down
    }
    const limit = await tick(diving(6), "go_to");
    expect(limit.winner).toMatchObject({ region: "reflex", urgency: 1, action: { skill: "surface" } });
  });

  it("eats to heal: hurt, below healing level, with safe food; and only up to that level", async () => {
    const { tick } = bot({ engineFails: true });
    await tick();
    const out = await tick({ self: { health: 10, food: 14, foodItems: 3 } });
    expect(out.winner).toMatchObject({ region: "medulla", action: { skill: "eat", target: "level:18" } });
    expect((await tick({ self: { health: 10, food: 18, foodItems: 3 } })).candidates.some((c) => c.region === "medulla")).toBe(false);
  });

  it("drinks the cure when poisoned and carrying it", async () => {
    const { tick } = bot({ engineFails: true });
    await tick();
    expect((await tick({ self: { effects: ["poison"], inventory: { milk_bucket: 1 } } })).winner).toMatchObject({ region: "medulla", action: { skill: "consume", target: "item:milk_bucket" } });
  });

  it("keeps running while the bot sleeps: a need that crosses its threshold competes, and starving wakes it", async () => {
    const inBed = { night: true, self: { asleep: true } };
    const { tick, value } = bot();
    await tick(inBed, "sleep");
    const calm = await tick(inBed, "sleep");
    expect(value("upper_paused")).toBe(1);
    expect(Object.keys(calm.traces)).toContain("medulla");
    expect(calm.won).toBe("sleep");
    // Hurt and a little hungry: the urge fires and is noted, but sleep outweighs it.
    const peckish = await tick({ night: true, self: { asleep: true, health: 19, food: 15, foodItems: 3 } }, "sleep", 60_000);
    expect(peckish.traces.medulla?.urgeWhileAsleep).toEqual(["eat_to_heal"]);
    expect(peckish.won).toBe("sleep");
    // Starving: the reflex outweighs staying asleep.
    const starving = await tick({ night: true, self: { asleep: true, health: 19, food: 5, foodItems: 3 } }, "sleep", 60_000);
    expect(starving.won).toBe("eat");
  });

  it("with the medulla left out, no vital signs are shared and the urges do not fire, but the hard reflexes still do", async () => {
    const { tick, store } = bot({ only: WITHOUT_MEDULLA });
    await tick();
    const short = await tick(diving(9));
    expect(short.candidates.some((c) => "skill" in c.action && c.action.skill === "surface")).toBe(false);
    expect((await tick({ self: { health: 10, food: 14, foodItems: 3 } })).candidates.some((c) => "skill" in c.action && c.action.skill === "eat")).toBe(false);
    expect(Object.keys(store.signals()).filter((name) => VITAL_SIGNS.includes(name))).toEqual([]);
    // The hard limit is not the medulla's to switch off.
    expect((await tick(diving(6))).winner).toMatchObject({ region: "reflex", urgency: 1, action: { skill: "surface" } });
    expect((await tick({ self: { inLava: true } })).winner).toMatchObject({ region: "reflex", action: { skill: "escape_hazard" } });
  });
});

describe("the defence circuit through the real brain", () => {
  /** A zombie in view that has not noticed the bot (it is not closing), and one that has. */
  const unaware = (dist: number): Mob => ({ ...mob("zombie", dist), seen: true, closing: 0, bearing: LEFT });
  const closing = (dist: number): Mob => ({ ...mob("zombie", dist), seen: true, closing: 2, bearing: LEFT });
  const armed = { bestWeapon: "stone_sword" };

  it("freezes for a threat that has not noticed, and flees the tick it notices and closes", async () => {
    const { tick, value } = bot();
    await tick();
    const still = await tick({ mobs: [unaware(10)] });
    expect(still.reflexes).toMatchObject([{ rule: "defence_freeze", skill: "freeze", base: 0.5 }]);
    expect(value("threat")).toBe(0.5);
    expect(still.traces.brainstem?.defence).toMatchObject({ mode: "freeze", target: "entity:1", flightDistance: 8, cornered: false });
    const noticed = await tick({ mobs: [closing(7)] }, "freeze");
    expect(noticed.reflexes).toMatchObject([{ rule: "defence_flee", skill: "flee" }]);
    expect(value("threat")).toBe(0.8);
    expect(noticed.won).toBe("flee");
  });

  it("is wary of what it cannot see: no reflex, a `wary` signal", async () => {
    const { tick, value } = bot();
    await tick();
    const out = await tick({ mobs: [{ ...mob("zombie", 12), seen: false, closing: 0, bearing: { side: "behind", angle: 170 } }] });
    expect(out.reflexes).toEqual([]);
    expect(value("wary")).toBe(1);
    expect(value("threat")).toBe(0.3);
    expect((await tick()).traces.brainstem?.defence).toBeUndefined();
    expect(value("wary")).toBe(0);
  });

  it("a goal that holds back defence_flee leaves freezing and fighting at full strength", async () => {
    const free = bot();
    const held = bot({ plan: { goal: "Hold the line", steps: [], reason: "", holdBack: ["defence_flee"] } });
    for (const b of [free, held]) await b.tick();
    for (const b of [free, held]) await b.tick();
    const gains = async (patch: Patch) => [(await free.tick(patch)).reflexes[0]!, (await held.tick(patch)).reflexes[0]!] as const;
    const [fleeFree, fleeHeld] = await gains({ mobs: [closing(6)] });
    expect(fleeHeld.rule).toBe("defence_flee");
    expect(fleeHeld.gain).toBeCloseTo(fleeFree.gain * 0.3);
    const [fightFree, fightHeld] = await gains({ self: armed, mobs: [closing(2)] });
    expect(fightHeld).toMatchObject({ rule: "defence_fight", skill: "attack" });
    expect(fightHeld.gain).toBeCloseTo(fightFree.gain);
    const calm = [bot(), bot({ plan: { goal: "Hold the line", steps: [], reason: "", holdBack: ["defence_flee"] } })];
    for (const b of calm) await b.tick();
    for (const b of calm) await b.tick();
    const [freezeFree, freezeHeld] = [(await calm[0]!.tick({ mobs: [unaware(9)] })).reflexes[0]!, (await calm[1]!.tick({ mobs: [unaware(9)] })).reflexes[0]!];
    expect(freezeHeld.rule).toBe("defence_freeze");
    expect(freezeHeld.gain).toBeCloseTo(freezeFree.gain);
  });

  it("alarm goes with a threat that cannot reach the bot, and holds with one that can", async () => {
    const alarmAfter = async (reachable: boolean) => {
      const { tick, value } = bot({ brainstem: { startle: 0 } });
      await tick();
      for (let i = 0; i < 3; i++) await tick({ mobs: [closing(5)] });
      const raised = value("alarm")!;
      for (let i = 0; i < 12; i++) await tick({ mobs: [{ ...closing(5), reachable }] }, null, 5000);
      return { raised, later: value("alarm")! };
    };
    const [can, cannot] = [await alarmAfter(true), await alarmAfter(false)];
    // With the threat still there and able to reach, alarm is what the danger presses at: it does not fade.
    expect(can.later).toBeGreaterThan(0.5);
    expect(cannot.later).toBeLessThan(0.05);
  });

  it("pain is dulled while fleeing or fighting and felt afterwards; the hard reflexes still see the damage", async () => {
    const run = async (analgesia: number) => {
      const { tick, value } = bot({ defence: { analgesia }, brainstem: { startle: 0 } });
      await tick();
      for (let i = 0; i < 6; i++) await tick({ mobs: [closing(6)] });
      const dulled = value("analgesia")!;
      const hit = await tick({ self: { health: 12 }, mobs: [closing(6)] });
      return { tick, value, dulled, pain: value("pain")!, hit };
    };
    const [on, off] = [await run(1), await run(0)];
    expect(on.dulled).toBeGreaterThan(0.6);
    expect(off.dulled).toBe(0);
    expect(off.pain).toBeGreaterThan(0.9);
    expect(on.pain).toBeCloseTo(off.pain * (1 - on.dulled), 1);
    // The medulla's own reading is the damage as it is.
    expect(on.hit.traces.medulla?.vitals).toMatchObject({ pain: off.pain });
    // Once the threat is gone the analgesia fades, within about 10 seconds.
    await on.tick({ self: { health: 12 } }, null, 5000);
    expect(on.value("analgesia")).toBeLessThan(0.2);
    await on.tick({ self: { health: 12 } }, null, 6000);
    expect(on.value("analgesia")).toBeLessThan(0.05);
    // Dulled or not, last_stand fires on the health itself.
    const dying = await (await run(1)).tick({ self: { health: 5 }, mobs: [closing(2)] });
    expect(dying.winner).toMatchObject({ region: "reflex", urgency: 1, action: { skill: "flee" } });
  });

  it("recuperates when hurt and clear after a flight, and stops when a threat returns", async () => {
    const { tick, value } = bot({ brainstem: { startle: 0 } });
    await tick();
    for (let i = 0; i < 3; i++) await tick({ self: { health: 8 }, mobs: [closing(6)] });
    expect(value("recovering")).toBe(0);
    await tick({ self: { health: 8 } });
    expect(value("recovering")).toBe(1);
    const resting = await tick({ self: { health: 8 } });
    expect(resting.reflexes).toContainEqual(expect.objectContaining({ rule: "recuperate", skill: "recuperate", base: 0.4 }));
    const back = await tick({ self: { health: 8 }, mobs: [closing(6)] }, "recuperate");
    expect(back.reflexes.map((r) => r.rule)).toEqual(["defence_flee"]);
    expect(value("recovering")).toBe(0);
    // Mended: no more resting.
    await tick({ self: { health: 8 } });
    expect((await tick({ self: { health: 16 } })).reflexes).toEqual([]);
    expect(value("recovering")).toBe(0);
  });
});

describe("arousal through the real brain", () => {
  const inBed = { night: true, self: { asleep: true } };
  const awake = async (b: ReturnType<typeof bot>, n = 3) => {
    for (let i = 0; i < n; i++) await b.tick();
  };

  it("with the reticular region left out, arousal is never shared, nothing pauses, and everything else runs", async () => {
    const only = ["reflex", "medulla", "brainstem", "colliculus", "acetylcholine", "dopamine", "noradrenaline", "hippocampus", "instinct", "serotonin", "prefrontal"];
    const { tick, calls, value } = bot({ only });
    await tick(inBed, "sleep");
    const before = calls.engine;
    for (let i = 0; i < 5; i++) {
      const out = await tick(inBed, "sleep");
      expect(out.errors).toEqual([]);
      expect(out.traces.instinct?.paused).toBeUndefined();
    }
    expect(calls.engine).toBe(before + 5);
    expect([value("arousal"), value("upper_paused"), value("upper_rate")]).toEqual([undefined, undefined, undefined]);
    // The colliculus reads a missing arousal as 0.5, and an ambush is still answered.
    expect((await tick({ mobs: [mob("zombie", 6)] })).won).toBe("flee");
  });

  it("goes to bed by itself when tired at night; not when it has just slept", async () => {
    const tired = bot();
    await tired.tick({ night: true, self: { sinceSleepMinutes: 1440 } });
    const out = await tired.tick({ night: true, self: { sinceSleepMinutes: 1440 } });
    expect(tired.value("sleepy")).toBeCloseTo(0.68, 1);
    expect(out.candidates).toContainEqual(expect.objectContaining({ region: "reticular", action: { skill: "sleep" } }));
    const fresh = bot();
    await fresh.tick({ night: true });
    expect((await fresh.tick({ night: true })).candidates.some((c) => c.region === "reticular")).toBe(false);
  });

  it("a starving sleeper is woken by the urge, before it is hurt, and eats", async () => {
    const { tick, value } = bot();
    for (let i = 0; i < 4; i++) await tick(inBed, "sleep");
    expect(value("upper_paused")).toBe(1);
    const out = await tick({ night: true, self: { asleep: true, food: 6, foodItems: 2 } }, "sleep");
    expect(out.traces.reticular?.waking).toMatchObject({ by: "urge", strength: 0.9, calm: false });
    expect(value("upper_paused")).toBe(0);
    expect(out.won).toBe("eat");
  });

  it("drowsy, instinct is asked less often; a threat brings every call straight back", async () => {
    // Tired at night with nowhere to sleep (bedtime off): arousal sinks and the gate narrows.
    const { tick, calls, value } = bot({ arousal: { bedtime: 0 } });
    const tiredNight = { night: true, self: { sinceSleepMinutes: 2000 } };
    for (let i = 0; i < 120; i++) await tick(tiredNight, "idle");
    expect(value("arousal")).toBeLessThan(0.35);
    expect(value("upper_rate")).toBeLessThan(0.4);
    const before = calls.engine;
    let saved = 0;
    for (let i = 0; i < 40; i++) saved += (await tick(tiredNight, "idle")).traces.instinct?.paused ? 1 : 0;
    expect(calls.engine - before).toBeLessThan(20);
    expect(calls.engine - before).toBeGreaterThan(0);
    expect(saved).toBe(40 - (calls.engine - before));
    const then = calls.engine;
    for (let i = 0; i < 4; i++) await tick({ ...tiredNight, mobs: [mob("zombie", 6)] }, "idle");
    expect(calls.engine - then).toBe(4);
    expect(value("upper_rate")).toBe(1);
  });

  it("frazzled above 0.9: instinct proposes fewer options", async () => {
    const options = (out: Awaited<ReturnType<ReturnType<typeof bot>["tick"]>>) => out.candidates.filter((c) => c.region === "instinct").length;
    const calm = bot({ spread: { idle: 0.4, go_to: 0.3, eat: 0.3 } });
    await awake(calm);
    expect(options(await calm.tick())).toBe(3);
    const { tick, value } = bot({ spread: { idle: 0.4, go_to: 0.3, eat: 0.3 } });
    await awake({ tick } as never);
    const swarm = { self: { bestWeapon: "stone_sword" }, mobs: [mob("zombie", 2, 1), mob("zombie", 3, 2), mob("zombie", 5, 3)] };
    let out = await tick(swarm);
    for (let i = 0; i < 8; i++) out = await tick(swarm);
    expect(value("arousal")).toBeGreaterThan(0.9);
    expect(value("frazzled")).toBe(1);
    expect(options(out)).toBe(2);
  });
});

describe("drives through the real brain", () => {
  type Out = Awaited<ReturnType<ReturnType<typeof bot>["tick"]>>;
  /** A day with hunger, a fight, a poisoning and a tired night in it: what won, what the reflexes did, and the dials. */
  async function day(options: Parameters<typeof bot>[0]) {
    const { tick, value } = bot(options);
    const seen: unknown[] = [];
    // (Search's inputs, not its level: its one-off bump for something new goes by the wall clock, which two ticks of a test can share.)
    const note = (out: Out) => seen.push({ rewards: out.traces.dopamine?.rewards, cues: out.traces.dopamine?.cues, searchInputs: out.traces.noradrenaline?.searchInputs, outlook: out.traces.serotonin?.outlook, won: out.won, urgency: out.winner?.urgency, reflexes: out.reflexes.map((r) => [r.rule, r.gain]), alarm: value("alarm"), patience: value("patience"), arousal: value("arousal") });
    for (let i = 0; i < 6; i++) note(await tick({ self: { food: 12 - i } }));
    for (let i = 0; i < 6; i++) note(await tick({ self: { food: 6, health: 20 - 2 * i }, mobs: [mob("zombie", 6 - i)] }));
    for (let i = 0; i < 6; i++) note(await tick({ self: { food: 3, health: 8, effects: ["poison"] } }, "idle"));
    for (let i = 0; i < 6; i++) note(await tick({ night: true, self: { food: 3, sinceSleepMinutes: 3000 } }, "idle"));
    return seen;
  }

  it("with every strength at 0 the brain does what it does with the hypothalamus left out", async () => {
    const all = ["reflex", "medulla", "hypothalamus", "brainstem", "reticular", "colliculus", "acetylcholine", "dopamine", "noradrenaline", "hippocampus", "instinct", "serotonin", "prefrontal"];
    expect(await day({ drives: DRIVES_OFF })).toEqual(await day({ drives: DRIVES_OFF, only: all.filter((name) => name !== "hypothalamus") }));
  });

  it("stress outlasts the danger and keeps patience lower for minutes, but never touches a reflex's gain", async () => {
    const live = async (drives: DriveSettings) => {
      const { tick, value } = bot({ drives });
      const gains: number[][] = [];
      // A minute and a half with a zombie on the bot, then calm.
      for (let i = 0; i < 180; i++) gains.push((await tick({ mobs: [mob("zombie", 2)] })).reflexes.map((r) => r.gain));
      const stressed = value("stress");
      for (let i = 0; i < 120; i++) gains.push((await tick()).reflexes.map((r) => r.gain));
      return { gains, stressed, stressLater: value("stress"), patienceLater: value("patience")! };
    };
    const [on, off] = [await live({ ...DRIVES_OFF, stress: 1 }), await live(DRIVES_OFF)];
    expect(on.stressed).toBeGreaterThan(0.6);
    expect(on.stressLater).toBeGreaterThan(0.5); // a minute after the zombie has gone
    expect(off.stressed).toBeUndefined();
    expect(on.patienceLater).toBeLessThan(off.patienceLater - 0.05);
    expect(on.gains).toEqual(off.gains);
  });

  it("a hard reflex wins as before whatever the drives say: starving and desperate, the bot still gets out of lava", async () => {
    for (const drives of [DEFAULT_DRIVES, DRIVES_OFF]) {
      const { tick, value } = bot({ drives });
      for (let i = 0; i < 4; i++) await tick({ self: { food: 0 } });
      const out = await tick({ self: { food: 0, inLava: true } });
      expect(out.winner).toMatchObject({ region: "reflex", urgency: 1 });
      if (drives === DEFAULT_DRIVES) expect(value("desperate")).toBe(1);
    }
  });
});
