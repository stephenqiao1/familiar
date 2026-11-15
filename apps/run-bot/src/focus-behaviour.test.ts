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
  playerAlarms,
  playerFocus,
  playerMemories,
  SCHEMA_VERSION,
  threatPresent,
  watchedThings,
  withTrust,
  type MinecraftStateData,
} from "@familiar/minecraft";
import { createFocusRegion, createNoradrenalineRegion, DEFAULT_FOCUS, DEFAULT_NORADRENALINE, trustOf } from "@familiar/neuromodulators";
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
    },
    nearby: { hazards: [], mobs: [], blocks: p.blocks ?? [], players: [], loud: [] },
    memory: null,
    current: null,
  };
  return { schemaVersion: SCHEMA_VERSION, tick: seconds, timestamp: seconds * 1000, data: { ...data } };
}

/** The bot's focus region (with real inputs) on one workspace, driven one second at a time. */
function bot(memory = createMemory()) {
  const store = createWorkspace();
  const region = createFocusRegion({ inputs: playerFocus(memory, skills), settings: DEFAULT_FOCUS, asleep, moved, watched: watchedThings, skillsToward: () => ["go_to"] });
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
  it("rises in the dark somewhere unfamiliar", async () => {
    const { live, focus } = bot();
    await live({ isNight: true, light: 0 }, 120, "go_to");
    expect(focus()).toBeGreaterThan(0.85);
  });

  it("falls doing nothing much somewhere well known by day", async () => {
    const { live, focus } = bot(familiar());
    await live({}, 120, "idle");
    expect(focus()).toBeLessThan(0.15);
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

describe("noisy or changed", () => {
  /** Alarm after one surprise of this size, at this focus. */
  async function alarmAfter(surprise: number, focus: number, byFocus = true) {
    const store = createWorkspace();
    const region = createNoradrenalineRegion({ triggers: playerAlarms(byFocus), threatPresent, settings: DEFAULT_NORADRENALINE });
    for (const seconds of [0, 1]) {
      store.update(state({}, seconds), null);
      store.viewFor("acetylcholine").setSignal("focus", focus);
      store.viewFor("dopamine").setSignal("bad_surprise", seconds === 1 ? surprise : 0);
      await region.run(store.viewFor("noradrenaline"), signal);
    }
    return store.signals().alarm!.value;
  }

  it("the same surprise trips alarm at low focus and does not at high focus", async () => {
    expect(await alarmAfter(0.5, 0.2)).toBeGreaterThan(0);
    expect(await alarmAfter(0.5, 0.9)).toBe(0);
  });

  it("with the effect off, the old fixed bar applies whatever focus is", async () => {
    expect(await alarmAfter(0.5, 0.2, false)).toBe(0);
    expect(await alarmAfter(0.7, 0.9, false)).toBeGreaterThan(0);
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
