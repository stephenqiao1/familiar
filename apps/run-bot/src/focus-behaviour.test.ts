// Behaviour tests for focus (acetylcholine), run through the bot's real wiring: the player's
// focus inputs, the focus region, chest trust, the planner's input and the memory region.
// Only the world is made up.

import type { Skill, State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { createMemory, createMemoryRegion } from "@familiar/memory";
import {
  asleep,
  createChestMemory,
  describeSituation,
  moved,
  placeOf,
  playerFocus,
  playerMemories,
  SCHEMA_VERSION,
  watchedThings,
  withTrust,
  type MinecraftStateData,
} from "@familiar/minecraft";
import { createFocusRegion, DEFAULT_FOCUS, trustOf } from "@familiar/neuromodulators";
import { describe, expect, it } from "vitest";

const signal = new AbortController().signal;
const MIN = 60_000;
const skill = (name: string, demanding = false): Skill<null> => ({ name, description: "", demanding, canRun: () => true, run: async () => ({ status: "done" }) });
const skills = [skill("go_to"), skill("idle"), skill("sleep"), skill("attack", true)];

type Patch = { isNight?: boolean; light?: number; enclosed?: boolean; asleep?: boolean; x?: number; health?: number; blocks?: MinecraftStateData["nearby"]["blocks"] };

function state(p: Patch, seconds: number): State {
  const data: MinecraftStateData = {
    time: { isNight: p.isNight ?? false, lightLevel: p.light ?? 15 },
    self: {
      position: { x: p.x ?? 0, y: 63, z: 0 },
      dimension: "overworld",
      health: p.health ?? 20,
      food: 20,
      heldItem: null,
      bestWeapon: null,
      inventoryFullPct: 0,
      foodItems: 8,
      badFoodItems: 0,
      saturation: 5,
      effects: [],
      freezing: 0,
      sinceSleepMinutes: 0,
      healing: false,
      inventory: {},
      distanceToBase: 40,
      biome: "plains",
      skyLight: 15,
      enclosed: p.enclosed ?? false,
      asleep: p.asleep ?? false,
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
    },
    nearby: { hazards: [], mobs: [], blocks: p.blocks ?? [], players: [], sudden: [], heard: [] },
    memory: null,
    current: null,
  };
  return { schemaVersion: SCHEMA_VERSION, tick: seconds, timestamp: seconds * 1000, data: { ...data } };
}

/** The bot's focus region (with real inputs) on one workspace, driven one second at a time. */
function bot(memory = createMemory()) {
  const store = createWorkspace();
  const region = createFocusRegion({ inputs: playerFocus(memory), settings: DEFAULT_FOCUS, asleep, moved, watched: watchedThings, skillsToward: () => ["go_to"] });
  let seconds = 0;
  const live = async (patch: Patch = {}, forSeconds = 1, running?: string) => {
    let out = { proposals: [] as unknown[] };
    for (let i = 0; i < forSeconds; i++) {
      store.update(state(patch, seconds++), running ? { skill: running, target: undefined, startedAt: 0 } : null);
      out = await region.run(store.viewFor("acetylcholine"), signal);
    }
    return out;
  };
  const focus = () => store.signals().focus!.value;
  return { store, memory, live, focus };
}

/** A memory store that knows the area around x = 0 well. */
function familiar() {
  const memory = createMemory();
  for (let i = 0; i < 5; i++) {
    memory.record({ kind: "reward", place: { x: i * 3, y: 63, z: 0, dimension: "overworld" }, summary: "", involved: [`thing${i}`], outcome: { feeling: "good", value: 1 } }, i * 100_000);
  }
  return memory;
}

describe("focus behaviour", () => {
  it("rises somewhere it knows nothing of", async () => {
    const { live, focus } = bot();
    await live({ isNight: true, light: 0 }, 120, "go_to");
    expect(focus()).toBeGreaterThan(0.85);
  });

  it("falls somewhere well known, with nothing going against what it expects", async () => {
    const { live, focus } = bot(familiar());
    await live({}, 120, "idle");
    expect(focus()).toBeLessThan(0.15);
  });

  it("is the same idle or busy, by day or by night: what it knows is no different", async () => {
    const levels: number[] = [];
    for (const [patch, running] of [[{}, "idle"], [{}, "attack"], [{ isNight: true, light: 0 }, "go_to"]] as const) {
      const { live, focus } = bot(familiar());
      await live(patch, 60, running);
      levels.push(focus());
    }
    expect(new Set(levels.map((l) => l.toFixed(3))).size).toBe(1);
  });

  it("rises when its predictions keep failing, though the place is well known, and settles once they hold again", async () => {
    const { store, live, focus } = bot(familiar());
    await live({}, 120);
    const settled = focus();
    for (let i = 0; i < 3; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      store.viewFor("dopamine").setSignal("surprise", 0.8);
      await live({}, 20);
    }
    expect(focus()).toBeGreaterThan(settled + 0.3);
    for (let i = 0; i < 6; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      store.viewFor("dopamine").setSignal("surprise", 0.01);
      await live({}, 20);
    }
    expect(focus()).toBeLessThan(settled + 0.1);
  });

  it("is forced to 0.05 while asleep", async () => {
    const { live, focus } = bot();
    await live({ isNight: true, light: 0 }, 60, "go_to");
    await live({ isNight: true, light: 0, asleep: true }, 1, "sleep");
    expect(focus()).toBe(0.05);
  });

  it("a cue seen once does not fire; seen twice in a row it fires exactly once, with a boost to go there", async () => {
    const { store, live } = bot();
    store.viewFor("prefrontal").setGoal({ text: "Find a chest", steps: [], reason: "", watchFor: ["chest"] });
    const chest = { blocks: [{ id: "pos:5,63,0", type: "chest", dist: 5 }] };
    expect((await live(chest)).proposals).toEqual([]);
    expect(store.signals().cue?.value).toBe(0);
    expect((await live(chest)).proposals).toMatchObject([{ action: { skill: "go_to", target: "pos:5,63,0" }, reason: "spotted the chest it was looking for" }]);
    expect(store.signals().cue?.value).toBe(1);
    await live(chest);
    expect(store.signals().cue?.value).toBe(0);
  });
});

describe("senses versus memory: a stale chest", () => {
  /** What the planner is told about storage, 10 minutes after the chest was last opened, at this focus. */
  function plannerSees(focus: number) {
    const chests = createChestMemory();
    chests.remember("pos:1,63,1", { bread: 8 }, 0);
    const lookups: { what: string; used: boolean }[] = [];
    const believed = withTrust(chests, (seenAt) => trustOf(10 * MIN - seenAt, DEFAULT_FOCUS.trustHalfLifeMinutes * MIN) > focus, (l) => lookups.push(l));
    const store = createWorkspace();
    store.update(state({}, 600), null);
    const text = describeSituation(store.viewFor("prefrontal"), [], { chests: believed, baseChest: "pos:1,63,1" });
    return { text, lookups };
  }

  it("assumes the old contents at low focus (familiar, daytime)", () => {
    const { text, lookups } = plannerSees(0.2);
    expect(text).toContain("- base chest pos:1,63,1: 8 bread");
    expect(lookups).toEqual([{ what: "chest pos:1,63,1", used: true }]);
  });

  it("treats the chest as unknown at high focus (night, or after a surprise), so the bot goes and checks", () => {
    const { text, lookups } = plannerSees(0.8);
    expect(text).toContain("Storage: no chest opened yet, so their contents are unknown.");
    expect(lookups).toEqual([{ what: "chest pos:1,63,1", used: false }]);
  });
});

describe("with every focus effect off", () => {
  it("memories keep their plain starting strength and nothing is consolidated, whatever focus is", async () => {
    const memory = createMemory();
    const store = createWorkspace();
    // As wired with memoryWrite and consolidation off: no focusOf, no resting.
    const region = createMemoryRegion({ memory, triggers: playerMemories(), placeOf });
    store.viewFor("acetylcholine").setSignal("focus", 0.05);
    for (const [seconds, health] of [[0, 20], [1, 12]] as const) {
      store.update(state({ health }, seconds), null);
      await region.run(store.viewFor("hippocampus"), signal);
    }
    const danger = memory.entries().memories.find((m) => m.kind === "danger");
    expect(danger?.strength).toBe(0.3);
    store.update(state({ health: 12 }, 2), null);
    expect((await region.run(store.viewFor("hippocampus"), signal)).trace?.consolidation).toBeUndefined();
  });

  it("a remembered chest is always believed", () => {
    const chests = createChestMemory();
    chests.remember("pos:1,63,1", { bread: 8 }, 0);
    // As wired with sensesVsMemory off: the plain chest memory, with no trust check.
    expect(chests.recall("pos:1,63,1")?.contents).toEqual({ bread: 8 });
  });
});
