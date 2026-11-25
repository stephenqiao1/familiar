import { NO_SELECTION } from "@familiar/basal-ganglia";
// Step One of the basal ganglia: the same winner as the arbiter it replaces. A table of cases
// (made by a seeded dice, so it is the same table every run) is put to both: the old arbiter,
// kept in old-arbiter.ts, and the basal ganglia with the terms listed in brain.ts. Each case is
// a run of ticks, so the rules that remember (the standing choice, giving up) are covered too.

import type { Candidate, Skill, State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { SCHEMA_VERSION, situationOf, type MinecraftStateData } from "@familiar/minecraft";
import { createPersistence, createScorebook, DEFAULT_PATIENCE, DEFAULT_PERSONALITY, PATIENCE_SIGNAL } from "@familiar/neuromodulators";
import { describe, expect, it } from "vitest";
import { createArbiter, createOldArbiter } from "./brain.js";

const zombie = { id: "entity:1", type: "zombie", dist: 4, hostile: true, reachable: true };
type Patch = { health?: number; food?: number; foodItems?: number; isNight?: boolean; unarmed?: boolean; mobs?: MinecraftStateData["nearby"]["mobs"] };

/** By default: healthy, fed, stocked and armed by day, with nothing nearby (a good outlook). */
function state(p: Patch, seconds: number): State {
  const data: MinecraftStateData = {
    time: { isNight: p.isNight ?? false, lightLevel: p.isNight ? 0 : 15 },
    self: {
      position: { x: 0, y: 63, z: 0 },
      dimension: "overworld",
      health: p.health ?? 20,
      food: p.food ?? 20,
      heldItem: null,
      bestWeapon: p.unarmed ? null : "stone_sword",
      inventoryFullPct: 10,
      foodItems: p.foodItems ?? 8,
      badFoodItems: 0,
      saturation: 5,
      effects: [],
      freezing: 0,
      sinceSleepMinutes: 0,
      healing: false,
      inventory: { stone_sword: 1, bread: 8 },
      distanceToBase: 40,
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
    },
    nearby: { hazards: [], mobs: p.mobs ?? [], blocks: [], players: [], sudden: [], heard: [] },
    memory: null,
    current: null,
  };
  return { schemaVersion: SCHEMA_VERSION, tick: seconds, timestamp: seconds * 1000, data: { ...data } };
}

/** A dice that rolls the same way every run. */
function dice(seed: number) {
  let s = seed;
  const roll = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return { roll, of: <T>(list: readonly T[]) => list[Math.floor(roll() * list.length)]!, chance: (p: number) => roll() < p };
}

const NAMES = ["attack", "go_to", "idle", "mine", "eat", "flee"];
const skill = (name: string): Skill<null> => ({ name, description: "", risky: name === "attack" || name === "mine", canRun: () => true, run: async () => ({ status: "done" }) });
const skills = NAMES.map(skill);
const REGIONS = [
  { region: "reflex", layer: 0 },
  { region: "colliculus", layer: 0 },
  { region: "dopamine", layer: 0 },
  { region: "instinct", layer: 1 },
  { region: "prefrontal", layer: 2 },
];
const SIGNALS = ["dopamine", "search_switching", "urge", "want", "desperate"];
const same = (a: Candidate | null, b: Candidate | null) => (a === null || b === null ? a === b : a.region === b.region && a.action === b.action);

/** One case: forty ticks of a made-up life, put to both arbiters. Returns how many ticks were compared and the first that differed. */
function run(seed: number) {
  const d = dice(seed);
  let now = 1_000_000;
  const make = () => {
    const scorebook = createScorebook();
    const persistence = createPersistence({ patience: () => 0.5, chanceOf: () => 0.5, strength: DEFAULT_PATIENCE.persistence });
    return { scorebook, persistence, parts: { scorebook, personality: DEFAULT_PERSONALITY, patience: DEFAULT_PATIENCE, persistence, skills, now: () => now } };
  };
  // Two of everything that remembers, fed the same, so neither arbiter can lean on the other's.
  const [a, b] = [make(), make()];
  const [older, newer] = [createOldArbiter(a.parts), createArbiter({ ...b.parts, selection: NO_SELECTION })];
  const both = (act: (side: ReturnType<typeof make>) => void) => [a, b].forEach(act);
  const store = createWorkspace();
  let running = null as string | null;
  const patch: Patch = d.chance(0.3) ? { health: 4, food: 3, foodItems: 0, mobs: [zombie] } : d.chance(0.3) ? { isNight: true, unarmed: true } : {};
  const situation = situationOf(state(patch, 0));
  for (let i = 0; i < 12; i++) both((side) => side.scorebook.learn(situation, NAMES[i % NAMES.length]!, i % 3 ? 1 : -1, 0.2));
  let urgent = 0;
  for (let tick = 0; tick < 40; tick++) {
    now += 250 + Math.floor(d.roll() * 1500);
    store.update(state(patch, tick), running === null ? null : { skill: running, target: undefined, startedAt: now });
    store.viewFor("serotonin").setSignal(PATIENCE_SIGNAL, d.roll());
    for (const name of SIGNALS) if (d.chance(0.6)) store.viewFor("test").setSignal(name, d.chance(0.4) ? 0 : d.roll());
    // Some layers speak and some stay silent; urgencies are close together, and sometimes full.
    const candidates: Candidate[] = REGIONS.filter(() => d.chance(0.55)).map(({ region, layer }) => {
      const name = d.of(NAMES);
      const action = d.chance(0.1) ? ({ keepGoing: true } as const) : { skill: name, ...(d.chance(0.3) ? { target: "entity:1" } : {}) };
      return { region, layer, urgency: d.chance(0.05) ? 1 : Math.round((0.4 + 0.4 * d.roll()) * 100) / 100, action, reason: name };
    });
    const ws = store.viewFor("arbiter");
    const [was, is] = [older.pick(candidates, ws), newer.pick(candidates, ws)];
    if (!same(was, is)) return { tick, was, is, urgent };
    if (was && was.urgency >= 1) urgent++;
    // The winner starts; now and then the running skill gets somewhere, ends, or is given up on.
    const won: string | null = was && "skill" in was.action ? was.action.skill : running;
    if (won !== running) {
      if (running !== null) both((side) => side.persistence.observe({ skill: running!, type: "interrupted", timestamp: now }));
      if (won !== null) both((side) => side.persistence.observe({ skill: won, type: "started", timestamp: now }));
      running = won;
    } else if (running !== null && d.chance(0.15)) {
      both((side) => side.persistence.progress(now));
    } else if (running !== null && d.chance(0.12)) {
      const gaveUp = d.chance(0.5);
      both((side) => {
        if (gaveUp) (side.persistence as unknown as { giveUpReason(now: number): unknown }).giveUpReason(now + 10 * 60_000);
        side.persistence.observe({ skill: running!, type: gaveUp ? "failed" : "done", timestamp: now });
      });
      running = null;
    }
  }
  return { tick: null, urgent };
}

describe("step one: the basal ganglia pick what the old arbiter picked", () => {
  it("the same winner on every tick of 300 made-up runs (12,000 choices)", () => {
    const differed = Array.from({ length: 300 }, (_, seed) => ({ seed, ...run(seed + 1) })).filter((r) => r.tick !== null);
    expect(differed.slice(0, 3)).toEqual([]);
  });

  it("the table really covers the rules: stays, holds, brakes, removals, standing choices and full urgency all take part", () => {
    const seen = new Set<string>();
    let urgent = 0;
    for (let seed = 1; seed <= 60; seed++) {
      urgent += run(seed).urgent;
    }
    // Run one case by hand with the trace open, to see which terms speak.
    const scorebook = createScorebook();
    const persistence = createPersistence({ patience: () => 0.5, chanceOf: () => 0.5, strength: 1 });
    let now = 0;
    const arbiter = createArbiter({ selection: NO_SELECTION, scorebook, personality: DEFAULT_PERSONALITY, patience: DEFAULT_PATIENCE, persistence, skills, now: () => now });
    const store = createWorkspace();
    const cand = (name: string, urgency: number, layer = 1, region = "instinct"): Candidate => ({ region, layer, urgency, action: { skill: name }, reason: name });
    const note = () => {
      const trace = arbiter.trace!() as { candidates: { terms: { term: string }[] }[]; removed?: { by: string }[]; recalled?: unknown[] };
      for (const c of trace.candidates) for (const t of c.terms) seen.add(t.term);
      for (const r of trace.removed ?? []) seen.add(r.by);
      if (trace.recalled?.length) seen.add("standing-choice");
    };
    const tick = (current: string | null, candidates: Candidate[], signals: Record<string, number> = {}) => {
      store.update(state({ health: 4, food: 3, foodItems: 0 }, 0), current === null ? null : { skill: current, target: undefined, startedAt: 0 });
      for (const [name, value] of Object.entries(signals)) store.viewFor("test").setSignal(name, value);
      arbiter.pick(candidates, store.viewFor("arbiter"));
      note();
    };
    scorebook.learn(situationOf(state({ health: 4, food: 3, foodItems: 0 }, 0)), "go_to", 1, 0.3);
    persistence.observe({ skill: "go_to", type: "started", timestamp: 0 });
    tick("go_to", [cand("go_to", 0.6), cand("attack", 0.55)], { want: 1 });
    tick("go_to", [cand("idle", 0.3, 0, "colliculus")]);
    (persistence as unknown as { giveUpReason(now: number): unknown }).giveUpReason(10 * 60_000);
    persistence.observe({ skill: "go_to", type: "failed", timestamp: 1000 });
    now = 2000;
    tick(null, [cand("go_to", 0.6), cand("idle", 0.2)]);
    expect([...seen].sort()).toEqual(["given-up", "hold-for-want", "learned-value", "restraint", "standing-choice", "stay"]);
    expect(urgent).toBeGreaterThan(20);
  });
});
