// Behaviour tests for alarm, search and memory (noradrenaline and the hippocampus), run through
// the bot's real wiring: the player's alarm and memory triggers, the noradrenaline and memory
// regions, the instinct questions and the arbiter. Only the world is made up.

import type { Candidate, Skill, State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { createMemory, createMemoryRegion, feelingNear, memoryNotes } from "@familiar/memory";
import { placeOf, playerAlarms, playerInstinct, playerMemories, SCHEMA_VERSION, threatPresent, type MinecraftStateData } from "@familiar/minecraft";
import {
  createNoradrenalineRegion,
  createPersistence,
  createScorebook,
  DEFAULT_NORADRENALINE,
  DEFAULT_PATIENCE,
  DEFAULT_PERSONALITY,
  type NoradrenalineSettings,
} from "@familiar/neuromodulators";
import { describe, expect, it } from "vitest";
import { createArbiter } from "./brain.js";

const signal = new AbortController().signal;
const OFF: NoradrenalineSettings = { ...DEFAULT_NORADRENALINE, inCharge: 0, interrupt: 0, focus: 0, memoryTag: 0, patienceLink: 0, switching: 0, widerOptions: 0, tellPlanner: 0 };
const zombie = { id: "entity:1", type: "zombie", dist: 3, hostile: true };

type Patch = { health?: number; x?: number; mobs?: MinecraftStateData["nearby"]["mobs"] };

/** Healthy and alone by day at `x`, unless the patch says otherwise. */
function state(p: Patch, seconds: number): State {
  const data: MinecraftStateData = {
    time: { isNight: false, lightLevel: 15 },
    self: {
      position: { x: p.x ?? 0, y: 63, z: 0 },
      dimension: "overworld",
      health: p.health ?? 20,
      food: 20,
      heldItem: null,
      bestWeapon: null,
      inventoryFullPct: 0,
      foodItems: 8,
      inventory: {},
      distanceToBase: 40,
      biome: "plains",
      skyLight: 15,
      enclosed: false,
      asleep: false,
      deaths: 0,
    },
    nearby: { hazards: [], mobs: p.mobs ?? [], blocks: [], players: [] },
    memory: null,
    current: null,
  };
  return { schemaVersion: SCHEMA_VERSION, tick: seconds, timestamp: seconds * 1000, data: { ...data } };
}

const skill = (name: string): Skill<null> => ({ name, description: "", canRun: () => true, run: async () => ({ status: "done" }) });
const skills = [skill("go_to"), skill("idle")];

/** The bot's alarm and memory regions on one workspace, driven one second at a time. */
function bot(settings: NoradrenalineSettings = DEFAULT_NORADRENALINE) {
  const store = createWorkspace();
  const memory = createMemory();
  const regions = [
    createNoradrenalineRegion({ triggers: playerAlarms(), threatPresent, settings }),
    createMemoryRegion({ memory, triggers: playerMemories(), placeOf, ...(settings.memoryTag > 0 ? { alarmOf: (ws) => ws.signals.alarm?.value ?? 0 } : {}) }),
  ];
  let seconds = 0;
  const live = async (patch: Patch = {}, forSeconds = 1) => {
    for (let i = 0; i < forSeconds; i++) {
      store.update(state(patch, seconds++), null);
      for (const region of regions) await region.run(store.viewFor(region.name), signal);
    }
  };
  const value = (name: string) => store.signals()[name]?.value;
  /** What Jev is asked for its next action. */
  const asked = () => {
    const [nextAction] = playerInstinct(skills, null).questions(store.viewFor("instinct"));
    return { prompt: nextAction?.kind === "choice" ? nextAction.prompt : "" };
  };
  const now = () => seconds * 1000;
  return { store, memory, live, value, asked, now };
}

describe("alarm behaviour", () => {
  it("a big hit raises alarm at once; with the threat gone it falls under 0.1 within about 2 minutes", async () => {
    const { live, value } = bot();
    await live();
    await live({ health: 12 });
    expect(value("alarm")).toBe(1);
    await live({ health: 12 }, 120);
    expect(value("alarm")).toBeLessThan(0.1);
  });

  it("an ambush takes the planner out of charge, then hands control back once calm", async () => {
    const { store, live, value, asked } = bot();
    await live();
    const setGoal = () => store.viewFor("prefrontal").setGoal({ text: "Build a shelter", steps: [], reason: "" });
    setGoal();
    expect(asked().prompt).toContain("Current goal: Build a shelter");

    // A zombie appears and hits hard: alarm jumps, the plan is cancelled, the planner goes offline.
    await live({ mobs: [zombie], health: 13 });
    expect(value("alarm")).toBe(1);
    expect([value("interrupt"), value("planner_offline"), value("planner_weight")]).toEqual([1, 1, 0]);
    expect(store.goal()).toBeNull();

    // Even if a goal were set now, Jev would not be shown it while the planner is offline.
    setGoal();
    await live({ mobs: [zombie], health: 13 });
    expect(asked().prompt).not.toContain("Current goal");

    // The zombie is gone: alarm fades, the planner comes back, and its goal counts again.
    await live({ health: 13 }, 40);
    expect(value("planner_offline")).toBe(0);
    expect(value("planner_weight")).toBeGreaterThan(0.75);
    expect(asked().prompt).toContain("Current goal: Build a shelter");
  });

  it("a frightening moment is remembered strongly, colours the place, and is told to the planner", async () => {
    const { memory, live, now } = bot();
    await live({ x: 100 });
    await live({ x: 100, mobs: [zombie], health: 13 });
    const [ambush] = memory.recall({ kind: "danger", limit: 1, touch: false }, now());
    expect(ambush).toMatchObject({ summary: "Took heavy damage from a zombie in plains", place: { x: 100 }, strength: expect.closeTo(0.8, 3) });

    // Back at the same spot later, the place feels bad; far away it does not.
    const there = { x: 100, y: 63, z: 0, dimension: "overworld" };
    expect(feelingNear(memory, there, now())).toEqual({ nearby: "bad", kind: "danger" });
    expect(feelingNear(memory, { ...there, x: 500 }, now())).toBeNull();
    const notes = memoryNotes(memory, there, now());
    expect(notes).toContain("- Took heavy damage from a zombie in plains (at 100,63,0)");
    expect(notes).toContain("- danger: zombie at 100,63,0");
  });

  it("the same event while calm is remembered more weakly", async () => {
    const calm = bot({ ...DEFAULT_NORADRENALINE, alarmGain: 0 });
    await calm.live();
    await calm.live({ health: 13 });
    expect(calm.memory.entries().memories.find((m) => m.kind === "danger")!.strength).toBe(0.3);
  });
});

describe("search behaviour", () => {
  const candidate = (name: string, urgency: number): Candidate => ({ region: "instinct", layer: 1, urgency, action: { skill: name }, reason: name });

  /** The arbiter's pick between the running go_to and a slightly better idle, at this switching level. */
  function pick(switching: number | null, settings = DEFAULT_PATIENCE) {
    const persistence = createPersistence({ patience: () => 0.5, chanceOf: () => 0.5, strength: settings.persistence });
    persistence.observe({ skill: "go_to", type: "started", timestamp: Date.now() });
    const arbiter = createArbiter({ scorebook: createScorebook(), personality: DEFAULT_PERSONALITY, patience: settings, persistence, skills });
    const store = createWorkspace();
    store.update(state({}, 0), null);
    if (switching !== null) store.viewFor("noradrenaline").setSignal("search_switching", switching);
    return arbiter.pick([candidate("go_to", 0.5), candidate("idle", 0.6)], store.viewFor("arbiter"));
  }

  it("makes switching easier when search is high: the margin is smaller at 0.9 than at 0.1", () => {
    expect(pick(0.1)).toMatchObject({ action: { skill: "go_to" }, reason: expect.stringContaining("bonus +0.18") });
    expect(pick(0.9)?.action).toEqual({ skill: "idle" });
  });

  it("leaves the margin alone at rest, and when the noradrenaline region is off", () => {
    expect(pick(0.3)?.reason).toContain("bonus +0.15");
    expect(pick(null)?.reason).toContain("bonus +0.15");
  });
});

describe("with every alarm and search effect off", () => {
  it("decides exactly as before: the goal stays, Jev is shown it, and the switch margin is unchanged", async () => {
    const { store, live, value, asked } = bot(OFF);
    await live();
    store.viewFor("prefrontal").setGoal({ text: "Build a shelter", steps: [], reason: "" });
    await live({ mobs: [zombie], health: 13 });
    expect(value("alarm")).toBe(1); // the dial still moves
    expect(store.goal()?.text).toBe("Build a shelter");
    expect(asked().prompt).toContain("Current goal: Build a shelter");
    expect([value("planner_weight"), value("planner_offline"), value("interrupt"), value("replan")]).toEqual([1, 0, 0, 0]);
    expect(value("search_switching")).toBeCloseTo(0.3);
  });

  it("still records memories, at their plain starting strength", async () => {
    const { memory, live } = bot(OFF);
    await live();
    await live({ mobs: [zombie], health: 13 });
    expect(memory.entries().memories.find((m) => m.kind === "danger")!.strength).toBe(0.3);
  });
});
