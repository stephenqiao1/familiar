// Behaviour tests for patience (serotonin), run through the bot's real wiring: the player's
// needs, the serotonin region, the arbiter and the prefrontal region. Only the world is
// made up: each tick is a hand-written state.

import type { Candidate, Planner, Skill, State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { needsNow, SCHEMA_VERSION, situationOf, type MinecraftStateData } from "@familiar/minecraft";
import {
  createPatienceRegion,
  createPersistence,
  chanceOfPayoff,
  createScorebook,
  DEFAULT_PATIENCE,
  DEFAULT_PERSONALITY,
  PATIENCE_SIGNAL,
  planningHorizon,
  type PatienceSettings,
} from "@familiar/neuromodulators";
import { createPrefrontalRegion } from "@familiar/region-prefrontal";
import { describe, expect, it } from "vitest";
import { createArbiter, patienceOf } from "./brain.js";

const signal = new AbortController().signal;
const OFF: PatienceSettings = { ...DEFAULT_PATIENCE, persistence: 0, horizon: 0, brake: 0 };
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

const GOOD: Patch = {};
/** Hurt, starving, unarmed, in the dark, with a zombie on top of it. */
const BAD: Patch = { health: 2, food: 2, foodItems: 0, isNight: true, unarmed: true, mobs: [{ ...zombie, dist: 1 }] };

/** The bot's serotonin region on a fresh workspace, driven one second at a time. */
function bot() {
  const store = createWorkspace();
  const region = createPatienceRegion({ needs: needsNow, settings: DEFAULT_PATIENCE });
  let seconds = 0;
  const live = async (patch: Patch, forSeconds = 1) => {
    for (let i = 0; i < forSeconds; i++) {
      store.update(state(patch, seconds++), null);
      await region.run(store.viewFor("serotonin"), signal);
    }
    return store.signals()[PATIENCE_SIGNAL]!.value;
  };
  return { store, live };
}

/** A workspace where patience is already at `level`. */
function workspaceAt(level: number) {
  const store = createWorkspace();
  store.update(state(GOOD, 0), null);
  store.viewFor("serotonin").setSignal(PATIENCE_SIGNAL, level);
  return store;
}

const skill = (name: string, risky = false): Skill<null> => ({ name, description: "", risky, canRun: () => true, run: async () => ({ status: "done" }) });
const skills = [skill("attack", true), skill("go_to")];
const candidate = (name: string, urgency: number, layer = 1): Candidate => ({ region: "instinct", layer, urgency, action: { skill: name }, reason: name });

function pick(patience: number, settings: PatienceSettings, candidates: Candidate[]) {
  const arbiter = createArbiter({ scorebook: createScorebook(), personality: DEFAULT_PERSONALITY, patience: settings, skills });
  return arbiter.pick(candidates, workspaceAt(patience).viewFor("arbiter"));
}

describe("patience behaviour", () => {
  describe("the dial follows the outlook", () => {
    it("rises toward about 0.9 after two good minutes", async () => {
      // Not quite 0.9: it has no torches and only a sword, which darken the outlook a little.
      expect(await bot().live(GOOD, 120)).toBeGreaterThan(0.8);
    });

    it("falls toward about 0.1 after two bad minutes", async () => {
      expect(await bot().live(BAD, 120)).toBeLessThan(0.2);
    });

    it("drops by a good 0.2 within a second of a threat appearing, and most of the way within three", async () => {
      const { live } = bot();
      const before = await live(GOOD, 60);
      const after = await live({ mobs: [zombie] });
      expect(before - after).toBeGreaterThan(0.2);
      expect(before - (await live({ mobs: [zombie] }, 2))).toBeGreaterThan(0.35);
    });

    it("starving with no food is a bad outlook, though all else is well", async () => {
      expect(await bot().live({ food: 0, foodItems: 0 }, 30)).toBeLessThan(0.5);
    });
  });

  describe("a) persistence", () => {
    const BASE_S = 120;
    /** A bot at this patience running go_to, with this record of past runs in its scorebook. */
    function running(patience: number, successes: number, failures: number, strength = 1) {
      const scorebook = createScorebook();
      for (let i = 0; i < successes + failures; i++) scorebook.record("day", "go_to", i < successes);
      const persistence = createPersistence({ patience: () => patience, chanceOf: (skill) => chanceOfPayoff(scorebook.get("day", skill)), strength });
      persistence.observe({ skill: "go_to", type: "started", timestamp: 0 });
      return { persistence, startedAt: 0 };
    }
    const giveUpSeconds = (patience: number, successes: number, failures: number) => {
      const { persistence, startedAt } = running(patience, successes, failures);
      return persistence.status(startedAt)!.giveUpSeconds;
    };

    it("waits longest with high patience and a good chance, less with a poor chance, least with low patience", () => {
      const patientLikely = giveUpSeconds(0.9, 8, 0);
      const patientUnlikely = giveUpSeconds(0.9, 0, 8);
      const impatientUnlikely = giveUpSeconds(0.1, 0, 8);
      expect(patientLikely).toBeGreaterThan(patientUnlikely);
      expect(patientUnlikely).toBeGreaterThan(impatientUnlikely);
    });

    it("high patience alone does not make it wait on a skill that rarely pays off", () => {
      expect(giveUpSeconds(0.9, 0, 8)).toBeLessThan(BASE_S);
    });

    it("keeps the running skill against a slightly better option, but not a clearly better one or a reflex", () => {
      const { persistence, startedAt } = running(0.5, 0, 0);
      const arbiter = createArbiter({ scorebook: createScorebook(), personality: DEFAULT_PERSONALITY, patience: DEFAULT_PATIENCE, persistence, skills });
      const ws = workspaceAt(0.5).viewFor("arbiter");
      const realNow = Date.now;
      Date.now = () => startedAt; // the arbiter asks the clock; the skill has only just started
      try {
        expect(arbiter.pick([candidate("go_to", 0.5), candidate("idle", 0.6)], ws)).toMatchObject({ action: { skill: "go_to" }, reason: expect.stringContaining("bonus +0.15") });
        expect(arbiter.pick([candidate("go_to", 0.5), candidate("idle", 0.7)], ws)?.action).toEqual({ skill: "idle" });
        expect(arbiter.pick([candidate("go_to", 0.5), candidate("attack", 1, 0)], ws)?.action).toEqual({ skill: "attack" });
        Date.now = () => startedAt + 10_000; // ten seconds with nothing to show for it: no protection left
        expect(arbiter.pick([candidate("go_to", 0.5), candidate("idle", 0.6)], ws)?.action).toEqual({ skill: "idle" });
        persistence.progress(startedAt + 10_000); // it got somewhere: protected again
        expect(arbiter.pick([candidate("go_to", 0.5), candidate("idle", 0.6)], ws)?.action).toEqual({ skill: "go_to" });
      } finally {
        Date.now = realNow;
      }
    });

    it("keeps the running skill in the vote while the layer that chose it is silent, and lets it go once that layer says otherwise", () => {
      const arbiter = createArbiter({ scorebook: createScorebook(), personality: DEFAULT_PERSONALITY, patience: OFF, skills });
      const store = workspaceAt(0.5);
      const glance: Candidate = { region: "colliculus", layer: 0, urgency: 0.35, action: { skill: "look_at" }, reason: "glance" };
      // Jev picks go_to, and it starts.
      expect(arbiter.pick([candidate("go_to", 0.6)], store.viewFor("arbiter"))?.action).toEqual({ skill: "go_to" });
      store.update(state(GOOD, 1), { skill: "go_to", target: undefined, startedAt: 0 });
      // Jev is not asked this tick; a glance is the only proposal. The journey stands.
      expect(arbiter.pick([glance], store.viewFor("arbiter"))).toMatchObject({ action: { skill: "go_to" }, reason: expect.stringContaining("still under way") });
      // A full-urgency reflex still wins.
      expect(arbiter.pick([{ ...glance, urgency: 1, action: { skill: "flee" } }], store.viewFor("arbiter"))?.action).toEqual({ skill: "flee" });
      // Jev speaks again and prefers something else: its word counts, the old choice does not stand against it.
      expect(arbiter.pick([candidate("idle", 0.3)], store.viewFor("arbiter"))?.action).toEqual({ skill: "idle" });
      // With the journey over, nothing stands.
      store.update(state(GOOD, 2), null);
      expect(arbiter.pick([glance], store.viewFor("arbiter"))?.action).toEqual({ skill: "look_at" });
    });

    it("a skill just given up on is not started again by a deciding layer until its wait is over; a reflex may at once", () => {
      const persistence = createPersistence({ patience: () => 0.5, chanceOf: () => 0.5, strength: 1 });
      const arbiter = createArbiter({ scorebook: createScorebook(), personality: DEFAULT_PERSONALITY, patience: OFF, persistence, skills });
      const ws = workspaceAt(0.5).viewFor("arbiter");
      persistence.observe({ skill: "go_to", type: "started", timestamp: 0 });
      const gaveUpAt = BASE_S * 1000;
      expect(persistence.giveUpReason(gaveUpAt)).toMatch(/^gave up/);
      persistence.observe({ skill: "go_to", type: "failed", timestamp: gaveUpAt });
      const realNow = Date.now;
      try {
        Date.now = () => gaveUpAt + 1000;
        expect(arbiter.pick([candidate("go_to", 0.9), candidate("idle", 0.2)], ws)?.action).toEqual({ skill: "idle" });
        expect(arbiter.pick([candidate("go_to", 0.9, 0), candidate("idle", 0.2)], ws)?.action).toEqual({ skill: "go_to" });
        Date.now = () => gaveUpAt + 8000;
        expect(arbiter.pick([candidate("go_to", 0.9), candidate("idle", 0.2)], ws)?.action).toEqual({ skill: "go_to" });
      } finally {
        Date.now = realNow;
      }
    });

    it("gives up sooner when patience collapses mid-skill, and holds on when the skill makes progress", () => {
      let patience = 0.9;
      const persistence = createPersistence({ patience: () => patience, chanceOf: () => 0.5, strength: 1 });
      persistence.observe({ skill: "go_to", type: "started", timestamp: 0 });
      expect(persistence.giveUpReason(100_000)).toBeNull();
      patience = 0.1;
      expect(persistence.giveUpReason(100_000)).toMatch(/^gave up after 100 s/);
      persistence.progress(100_000);
      expect(persistence.giveUpReason(101_000)).toBeNull();
    });

    it("guardrail: ignores patience once a skill has gone over 3× its time with no success", () => {
      const persistence = createPersistence({ patience: () => 0.95, chanceOf: () => 0.5, strength: 1 });
      persistence.observe({ skill: "go_to", type: "started", timestamp: 0 });
      persistence.observe({ skill: "go_to", type: "interrupted", timestamp: 3 * BASE_S * 1000 });
      persistence.observe({ skill: "go_to", type: "started", timestamp: 3 * BASE_S * 1000 });
      expect(persistence.status(3 * BASE_S * 1000 + 1)).toMatchObject({ overPersisting: true, giveUpSeconds: BASE_S });
    });
  });

  describe("b) planning horizon", () => {
    /** What the planner is asked, and the steps kept, at this patience. */
    async function plan(patience: number, settings: PatienceSettings) {
      let asked = "";
      const planner: Planner = {
        name: "fixed",
        plan: async ({ situation }) => ((asked = situation), { goal: "g", steps: ["1", "2", "3", "4", "5", "6"], reason: "" }),
      };
      const store = workspaceAt(patience);
      const region = createPrefrontalRegion({ planner, describe: () => "situation", guidance: (ws) => planningHorizon(patienceOf(ws, settings), settings.horizon) });
      await region.run(store.viewFor("prefrontal"), signal);
      return { asked, steps: store.goal()!.steps.length };
    }

    it("tells the planner to think short and keeps 2 steps when patience is low", async () => {
      const { asked, steps } = await plan(0.1, DEFAULT_PATIENCE);
      expect(asked).toContain("Focus on immediate needs.");
      expect(steps).toBe(2);
    });

    it("allows longer projects and 5 steps when patience is high", async () => {
      const { asked, steps } = await plan(0.9, DEFAULT_PATIENCE);
      expect(asked).toContain("You can afford longer projects");
      expect(steps).toBe(5);
    });
  });

  describe("c) restraint: what has been learned to be costly is held back", () => {
    const choice = [candidate("attack", 0.6), candidate("go_to", 0.55)];

    it("scores a risky skill lower at patience 0.9 than at 0.1", () => {
      expect(pick(0.1, DEFAULT_PATIENCE, choice)?.action).toEqual({ skill: "attack" });
      expect(pick(0.9, DEFAULT_PATIENCE, choice)).toMatchObject({ action: { skill: "go_to" } });
      expect(pick(0.1, DEFAULT_PATIENCE, choice)?.reason).toContain("scaled ×1.14");
    });

    it("never touches a reflex: the defence circuit's own fight is not held back, however patient the bot", () => {
      const fight: Candidate = { region: "reflex", layer: 0, urgency: 0.6, action: { skill: "attack" }, reason: "defence_fight" };
      const picked = pick(0.9, DEFAULT_PATIENCE, [fight, candidate("go_to", 0.55)]);
      expect(picked?.action).toEqual({ skill: "attack" });
      expect(picked?.reason).not.toContain("scaled");
    });

    it("goes by what was learned: a skill that has cost the bot is held back though not marked risky, and a risky one that keeps paying is held back less", () => {
      const at = (scorebook: ReturnType<typeof createScorebook>, name: string) => {
        const arbiter = createArbiter({ scorebook, personality: DEFAULT_PERSONALITY, patience: DEFAULT_PATIENCE, skills });
        return Number(/scaled ×([\d.]+)/.exec(arbiter.pick([candidate(name, 0.9)], workspaceAt(0.9).viewFor("arbiter"))!.reason)?.[1] ?? 1);
      };
      const situation = situationOf(state(GOOD, 0));
      // Nothing learned: only the skill marked risky is held back.
      expect(at(createScorebook(), "go_to")).toBe(1);
      expect(at(createScorebook(), "attack")).toBeCloseTo(0.66);
      // A journey that went badly, three times.
      const hurt = createScorebook();
      for (let i = 0; i < 3; i++) hurt.learn(situation, "go_to", -1, 0.1);
      expect(at(hurt, "go_to")).toBeLessThan(0.95);
      // Fights that went well.
      const won = createScorebook();
      for (let i = 0; i < 6; i++) won.learn(situation, "attack", 1, 0.1);
      expect(at(won, "attack")).toBeGreaterThan(0.75);
    });

    it("never holds back a full-urgency safety reflex", () => {
      const reflex = candidate("attack", 1, 0);
      expect(pick(0.95, DEFAULT_PATIENCE, [reflex, candidate("go_to", 0.9)])?.action).toEqual({ skill: "attack" });
    });
  });

  describe("with all three effects off", () => {
    it("decides exactly as it did without patience, at any patience level", async () => {
      const choice = [candidate("attack", 0.6), candidate("go_to", 0.55)];
      for (const patience of [0.05, 0.5, 0.95]) {
        // Arbiter: same winner, and no trace of a brake.
        expect(pick(patience, OFF, choice)).toEqual({ ...choice[0], reason: "attack; value 0.00" });
        // Persistence: no stay bonus, no giving up early, and the same 2-minute stop as before.
        const persistence = createPersistence({ patience: () => patience, chanceOf: () => 0.5, strength: 0 });
        persistence.observe({ skill: "attack", type: "started", timestamp: 0 });
        expect(persistence.stayBonus("attack", 0)).toBe(0);
        expect(persistence.giveUpReason(999_999)).toBeNull();
        expect(persistence.backstopMs()).toBe(120_000);
        // Planner: nothing added, nothing capped.
        expect(planningHorizon(patience, 0)).toEqual({});
      }
    });
  });
});
