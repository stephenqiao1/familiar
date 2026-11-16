// Behaviour tests for dopamine (section 10 of the Neuromodulators doc), run through the bot's real
// wiring: the player's reward rules, situation labels and cues, the dopamine region and the
// value-weighted arbiter. Only the world is made up: each tick is a hand-written state.

import type { Candidate, RegionOutput, SkillEvent, State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { SCHEMA_VERSION, situationOf, type MinecraftStateData } from "@familiar/minecraft";
import { createNoveltyMemory, createScorebook, DEATH_OUTCOME, DEFAULT_PATIENCE, DEFAULT_PERSONALITY, DOPAMINE_SIGNAL } from "@familiar/neuromodulators";
import { describe, expect, it } from "vitest";
import { createArbiter, createPlayerDopamine } from "./brain.js";

const signal = new AbortController().signal;
const CHEST = "pos:6,63,0";
/** Long enough between trips for habituation and DA to settle back. */
const BETWEEN_TRIPS_MS = 30 * 60_000;

type Patch = { food?: number; foodItems?: number; deaths?: number };

/** Hungry, on the surface by day, alone, with a chest in view. */
function state(p: Patch, timestamp: number): State {
  const data: MinecraftStateData = {
    time: { isNight: false, lightLevel: 15 },
    self: {
      position: { x: 0, y: 63, z: 0 },
      dimension: "overworld",
      health: 20,
      food: p.food ?? 10,
      heldItem: null,
      bestWeapon: null,
      inventoryFullPct: 0,
      foodItems: p.foodItems ?? 0,
      inventory: {},
      distanceToBase: 40,
      biome: "plains",
      skyLight: 15,
      enclosed: false,
      asleep: false,
      deaths: p.deaths ?? 0,
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
      locomotion: { moving: false, pattern: null, gait: "walk", stuck: false },
    },
    nearby: { hazards: [], mobs: [], blocks: [{ id: CHEST, type: "chest", dist: 6 }], players: [], loud: [] },
    memory: null,
    current: null,
  };
  return { schemaVersion: SCHEMA_VERSION, tick: 0, timestamp, data: { ...data } };
}

/** A bot with a fresh scorebook, driven one tick at a time. */
function bot() {
  const store = createWorkspace();
  const scorebook = createScorebook();
  const dopamine = createPlayerDopamine({
    scorebook,
    novelty: createNoveltyMemory(),
    personality: DEFAULT_PERSONALITY,
    skillsToward: () => ["go_to"],
  });
  let now = 0;
  const tick = (patch: Patch = {}, events: Omit<SkillEvent, "timestamp">[] = []): RegionOutput => {
    for (const e of events) store.addEvent({ ...e, timestamp: now });
    now += 500;
    store.update(state(patch, now), null);
    return dopamine.run(store.viewFor("dopamine"), signal) as RegionOutput;
  };
  const wait = (ms: number) => {
    now += ms;
  };
  // Settle in: the first tick has nothing to compare, the second notices everything (novelty).
  tick();
  tick();

  /** Walks to the chest; returns the episode as learned, and the chest cue's boost afterwards (0 if none). */
  function tripToChest(foodFound: number) {
    wait(BETWEEN_TRIPS_MS);
    tick();
    tick({}, [{ skill: "go_to", target: CHEST, type: "started" }]);
    const done = tick({ foodItems: foodFound }, [{ skill: "go_to", type: "done" }]);
    wait(BETWEEN_TRIPS_MS);
    const after = tick();
    const episode = (done.trace?.episodes as { surprise: number; toward?: string }[])[0]!;
    const cue = (after.trace?.cues as { boost: number }[] | undefined)?.[0];
    return { episode, boost: cue?.boost ?? 0, proposals: after.proposals };
  }

  return { store, scorebook, tick, wait, tripToChest };
}

const situation = situationOf(state({}, 0));

describe("dopamine behaviour", () => {
  describe("effort: low DA picks the easy option without changing what it prefers", () => {
    // Rich: worth more on average, but costly. Cheap: worth less, but cheap.
    const scorebook = createScorebook([
      { situation, skill: "go_to", expected: 0.6, benefit: 2, cost: 1.5 },
      { situation, skill: "idle", expected: 0.3, benefit: 0.8, cost: 0.2 },
    ]);
    const arbiter = createArbiter({ scorebook, personality: DEFAULT_PERSONALITY, patience: DEFAULT_PATIENCE, skills: [] });
    const candidate = (skill: string): Candidate => ({ region: "instinct", layer: 1, urgency: 0.5, action: { skill }, reason: skill });

    function pickAt(da: number): string {
      const store = createWorkspace();
      store.update(state({}, 0), null);
      store.viewFor("dopamine").setSignal(DOPAMINE_SIGNAL, da);
      const winner = arbiter.pick([candidate("go_to"), candidate("idle")], store.viewFor("arbiter"));
      return winner && "skill" in winner.action ? winner.action.skill : "none";
    }

    it("takes the costly but rewarding option when DA is high", () => {
      expect(pickAt(0.8)).toBe("go_to");
    });

    it("takes the cheap option when DA is low", () => {
      expect(pickAt(0.2)).toBe("idle");
    });

    it("still prefers the better option: what it expects is unchanged", () => {
      expect(scorebook.get(situation, "go_to").expected).toBeGreaterThan(scorebook.get(situation, "idle").expected);
    });
  });

  describe("learning: food in the chest ten times", () => {
    it("is surprised less every trip, and starts wanting the chest", () => {
      const { tripToChest } = bot();
      const trips = Array.from({ length: 10 }, () => tripToChest(4));
      const surprises = trips.map((t) => t.episode.surprise);

      expect(trips[0]!.episode.toward).toBe("chest");
      expect(surprises[0]).toBeCloseTo(0.5); // half its food-stock need met
      for (let i = 1; i < 10; i++) expect(surprises[i]).toBeLessThan(surprises[i - 1]!);
      expect(surprises[9]).toBeLessThan(0.5 * surprises[0]!);

      const last = trips[9]!;
      expect(last.boost).toBeGreaterThan(0);
      expect(last.proposals).toMatchObject([{ action: { skill: "go_to", target: CHEST }, reason: expect.stringMatching(/^wants the chest/) }]);
    });
  });

  describe("disappointment: then the chest is empty", () => {
    it("is negatively surprised, expects less each trip, and wants the chest less and less", () => {
      const { scorebook, tripToChest } = bot();
      for (let i = 0; i < 10; i++) tripToChest(4);
      const expectedBefore = scorebook.get(situation, "go_to→chest").expected;
      const peak = tripToChest(4).boost;

      const empty = Array.from({ length: 30 }, () => tripToChest(0));
      for (const trip of empty) expect(trip.episode.surprise).toBeLessThan(0);
      expect(scorebook.get(situation, "go_to→chest").expected).toBeLessThan(0.1 * expectedBefore);
      for (let i = 1; i < empty.length; i++) expect(empty[i]!.boost).toBeLessThan(empty[i - 1]!.boost);
      // It fades toward nothing but never quite stops: an empty trip costs nothing yet
      // (the "wasted time" penalty is still a TODO), so the expectation only approaches 0.
      expect(empty.at(-1)!.boost).toBeLessThan(0.1 * peak);
      expect(empty.at(-1)!.boost).toBeGreaterThan(0);
    });
  });

  describe("death guardrail", () => {
    it("teaches the skill that was running a large negative surprise", () => {
      const { scorebook, tick } = bot();
      tick({}, [{ skill: "go_to", target: CHEST, type: "started" }]);
      tick({ deaths: 1 });
      const out = tick({ deaths: 1 }, [{ skill: "go_to", type: "interrupted" }]);
      expect(out.trace?.episodes).toMatchObject([{ skill: "go_to", fatal: true, outcome: DEATH_OUTCOME }]);
      expect(scorebook.get(situation, "go_to").expected).toBeCloseTo(0.1 * DEATH_OUTCOME);
      expect(scorebook.get(situation, "go_to→chest").expected).toBeCloseTo(0.1 * DEATH_OUTCOME);
    });

    it("blames the skill that ended just before, if none was running", () => {
      const { scorebook, tick } = bot();
      tick({}, [{ skill: "idle", type: "started" }]);
      tick({}, [{ skill: "idle", type: "done" }]);
      const out = tick({ deaths: 1 });
      expect(out.trace?.blamedForDeath).toMatchObject({ skill: "idle", outcome: DEATH_OUTCOME });
      expect(scorebook.get(situation, "idle").expected).toBeLessThan(0);
    });
  });
});
