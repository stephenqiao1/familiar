import { NO_SELECTION } from "@familiar/basal-ganglia";
// Behaviour tests for dopamine (section 10 of the Neuromodulators doc), run through the bot's real
// wiring: the player's reward rules, situation labels and cues, the dopamine region and the
// value-weighted arbiter. Only the world is made up: each tick is a hand-written state.

import type { Candidate, RegionOutput, SkillEvent, State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { needsNow, playerDayTime, playerNeeds, SCHEMA_VERSION, situationOf, type MinecraftStateData } from "@familiar/minecraft";
import { createNoradrenalineRegion, createNoveltyMemory, createPatienceRegion, createScorebook, DEATH_OUTCOME, DEFAULT_NORADRENALINE, DEFAULT_PATIENCE, DEFAULT_PERSONALITY, DOPAMINE_SIGNAL } from "@familiar/neuromodulators";
import { createHypothalamusRegion, DEFAULT_DRIVES, DRIVES_OFF } from "@familiar/region-hypothalamus";
import { describe, expect, it } from "vitest";
import { createArbiter, createPlayerDopamine } from "./brain.js";

const signal = new AbortController().signal;
const CHEST = "pos:6,63,0";
/** Long enough between trips for habituation and DA to settle back. */
const BETWEEN_TRIPS_MS = 30 * 60_000;

type Patch = { food?: number; foodItems?: number; deaths?: number; x?: number; health?: number; inventory?: Record<string, number>; mobs?: MinecraftStateData["nearby"]["mobs"] };

/** Hungry, on the surface by day, alone, with a chest in view. */
function state(p: Patch, timestamp: number): State {
  const data: MinecraftStateData = {
    time: { isNight: false, lightLevel: 15 },
    self: {
      position: { x: p.x ?? 0, y: 63, z: 0 },
      dimension: "overworld",
      health: p.health ?? 20,
      food: p.food ?? 10,
      heldItem: null,
      bestWeapon: null,
      inventoryFullPct: 0,
      foodItems: p.foodItems ?? 0,
      badFoodItems: 0,
      saturation: 5,
      effects: [],
      freezing: 0,
      sinceSleepMinutes: 0,
      healing: false,
      inventory: p.inventory ?? {},
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
      support: { on: "stone", kind: "solid", edges: 0, headroom: 3 },
      velocity: { x: 0, y: 0, z: 0, onGround: true },
      landing: null,
      displaced: false,
      balance: 1,
      gaze: { id: null, yaw: 0 },
      locomotion: { moving: false, pattern: null, gait: "walk", stuck: false },
    },
    nearby: { hazards: [], mobs: p.mobs ?? [], blocks: [{ id: CHEST, type: "chest", dist: 6 }], players: [], sudden: [], heard: [] },
    memory: null,
    current: null,
  };
  return { schemaVersion: SCHEMA_VERSION, tick: 0, timestamp, data: { ...data } };
}

/** How far the bot walks in one tick (half a second). */
const BLOCKS_A_TICK = 2;
const NEAR = 6;
const FAR = 48;

/** A bot with a fresh scorebook, driven one tick at a time. `wastedEffort: 0` never counts wasted effort. */
function bot(wastedEffort = DEFAULT_PERSONALITY.wastedEffort) {
  const store = createWorkspace();
  const scorebook = createScorebook();
  const dopamine = createPlayerDopamine({
    scorebook,
    novelty: createNoveltyMemory(),
    personality: { ...DEFAULT_PERSONALITY, wastedEffort },
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

  /** Walks `blocks` to the chest; returns the episode as learned, and how much it wants the chest afterwards (0 if none). */
  function tripToChest(foodFound: number, blocks = NEAR) {
    wait(BETWEEN_TRIPS_MS);
    tick();
    tick({}, [{ skill: "go_to", target: CHEST, type: "started" }]);
    for (let x = BLOCKS_A_TICK; x < blocks; x += BLOCKS_A_TICK) tick({ x });
    const done = tick({ x: blocks, foodItems: foodFound }, [{ skill: "go_to", type: "done" }]);
    wait(BETWEEN_TRIPS_MS);
    const after = tick();
    const episode = (done.trace?.episodes as { surprise: number; toward?: string; wasted?: number }[])[0]!;
    const cue = (after.trace?.cues as { want: number }[] | undefined)?.[0];
    return { episode, want: cue?.want ?? 0, proposals: after.proposals };
  }

  return { store, scorebook, tick, wait, tripToChest };
}

const situation = situationOf(state({}, 0));
const THE_CHEST = { kind: "chest", id: CHEST };

describe("dopamine behaviour", () => {
  describe("effort: low DA picks the easy option without changing what it prefers", () => {
    // Rich: worth more on average, but costly. Cheap: worth less, but cheap.
    const scorebook = createScorebook([
      { feature: "go_to", expected: 0.6, benefit: 2, cost: 1.5 },
      { feature: "idle", expected: 0.3, benefit: 0.8, cost: 0.2 },
    ]);
    const arbiter = createArbiter({ selection: NO_SELECTION, scorebook, personality: DEFAULT_PERSONALITY, patience: DEFAULT_PATIENCE, skills: [] });
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
      expect(surprises[0]).toBeCloseTo(0.75); // its food stock went from none to half of enough: 1² − 0.5²
      for (let i = 1; i < 10; i++) expect(surprises[i]).toBeLessThan(surprises[i - 1]!);
      expect(surprises[9]).toBeLessThan(0.5 * surprises[0]!);

      const last = trips[9]!;
      expect(last.want).toBeGreaterThan(0);
      expect(last.proposals).toMatchObject([{ action: { skill: "go_to", target: CHEST }, reason: expect.stringMatching(/^wants the chest/) }]);
    });
  });

  describe("a pressing need loosens the hold of a running skill that does not serve it", () => {
    const jev = (skill: string, urgency: number): Candidate => ({ region: "instinct", layer: 1, urgency, action: { skill }, reason: skill });
    /** Ten good trips, then Jev is busy walking home (0.72) with `foodItems` carried: who wins? */
    function busyWith(foodItems: number, others: Candidate[] = []) {
      const { tripToChest, tick, store, scorebook } = bot();
      for (let i = 0; i < 10; i++) tripToChest(4);
      const wants = tick({ foodItems }).proposals.map((p): Candidate => ({ ...p, region: "dopamine", layer: 0 }));
      const arbiter = createArbiter({ selection: NO_SELECTION, scorebook, personality: DEFAULT_PERSONALITY, patience: DEFAULT_PATIENCE, skills: [] });
      return { wants, winner: arbiter.pick([jev("return_to_base", 0.72), ...others, ...wants], store.viewFor("arbiter"))! };
    }

    it("with no food left, the want for the chest interrupts Jev's walk, though its own urgency is lower", () => {
      const { wants, winner } = busyWith(0);
      expect(wants[0]!.urgency).toBeLessThan(0.72);
      expect(winner).toMatchObject({ region: "dopamine", action: { skill: "go_to", target: CHEST } });
    });

    it("with a threat close, the chest is not wanted and Jev's defence keeps its hold; the threat gone, it is wanted again", () => {
      const { tripToChest, tick, store, scorebook } = bot();
      for (let i = 0; i < 10; i++) tripToChest(4);
      const arbiter = createArbiter({ selection: NO_SELECTION, scorebook, personality: DEFAULT_PERSONALITY, patience: DEFAULT_PATIENCE, skills: [] });
      const pick = (out: RegionOutput) => arbiter.pick([jev("attack", 0.72), ...out.proposals.map((p): Candidate => ({ ...p, region: "dopamine", layer: 0 }))], store.viewFor("arbiter"))!;
      const husk = (dist: number) => ({ id: "entity:9", type: "husk", dist, hostile: true, reachable: true });
      const threatened = tick({ foodItems: 0, mobs: [husk(1)] });
      expect(threatened.proposals).toEqual([]);
      expect(pick(threatened)).toMatchObject({ action: { skill: "attack" } });
      expect(pick(threatened).reason).not.toMatch(/scaled/);
      expect(pick(tick({ foodItems: 0 }))).toMatchObject({ region: "dopamine", action: { skill: "go_to", target: CHEST } });
    });

    it("only a little short, Jev finishes the walk first", () => {
      const { wants, winner } = busyWith(6);
      expect(wants).toHaveLength(1);
      expect(winner.action).toEqual({ skill: "return_to_base" });
    });

    it("never weakens a reflex, and keeps Jev's own options in the same order", () => {
      const flee: Candidate = { region: "reflexes", layer: 0, urgency: 0.95, action: { skill: "flee" }, reason: "flee" };
      expect(busyWith(0, [flee]).winner.action).toEqual({ skill: "flee" });
      // Two of Jev's options, neither serving the need: both are loosened alike.
      const { store, scorebook, tick } = bot();
      tick({ foodItems: 0 });
      const arbiter = createArbiter({ selection: NO_SELECTION, scorebook, personality: DEFAULT_PERSONALITY, patience: DEFAULT_PATIENCE, skills: [] });
      const pick = () => arbiter.pick([jev("return_to_base", 0.5), jev("idle", 0.45)], store.viewFor("arbiter"))!;
      // With nothing wanted (no chest known) nothing is loosened at all.
      expect(pick().reason).not.toMatch(/scaled/);
      expect(pick().action).toEqual({ skill: "return_to_base" });
    });
  });

  describe("disappointment: then the chest is empty", () => {
    /** Ten good trips to a chest `blocks` away, then empty ones until it stops wanting the chest (or `most` trips). */
    function emptied(blocks: number, wastedEffort?: number, most = 60) {
      const { scorebook, tripToChest } = bot(wastedEffort);
      for (let i = 0; i < 10; i++) tripToChest(4, blocks);
      const expectedBefore = scorebook.get(situation, "go_to", THE_CHEST).expected;
      const peak = tripToChest(4, blocks).want;
      const empty = [];
      while (empty.length < most && (empty.at(-1)?.want ?? peak) > 0) empty.push(tripToChest(0, blocks));
      return { scorebook, tripToChest, expectedBefore, peak, empty };
    }

    it("is negatively surprised, wants the chest less each trip, and then stops checking", () => {
      const { scorebook, tripToChest, peak, empty } = emptied(NEAR);
      expect(peak).toBeGreaterThan(0);
      // While it still expects the trip to pay, each empty one is a disappointment and its effort is charged.
      const hopeful = empty.slice(0, -1);
      expect(hopeful.length).toBeGreaterThan(3);
      for (const trip of hopeful) expect(trip.episode.surprise).toBeLessThan(0);
      for (const trip of hopeful) expect(trip.episode.wasted).toBeGreaterThan(0);
      for (let i = 1; i < empty.length; i++) expect(empty[i]!.want).toBeLessThan(empty[i - 1]!.want);

      // The pull is gone, not just faint: heading there now expects less than nothing.
      expect(empty.length).toBeLessThan(60);
      expect(empty.at(-1)!.want).toBe(0);
      expect(empty.at(-1)!.proposals).toEqual([]);
      expect(scorebook.get(situation, "go_to", THE_CHEST).expected).toBeLessThan(0);

      // Sent there anyway, it is not charged again (it expected nothing), and it does not start wanting it.
      for (let i = 0; i < 20; i++) {
        const again = tripToChest(0);
        expect(again.episode.wasted).toBeUndefined();
        expect(again.want).toBe(0);
      }
      expect(scorebook.get(situation, "go_to", THE_CHEST).expected).toBeLessThan(0);
    });

    it("gives up on a far chest sooner than a near one: more effort wasted each trip", () => {
      const near = emptied(NEAR);
      const far = emptied(FAR);
      expect(far.empty[0]!.episode.wasted).toBeGreaterThan(3 * near.empty[0]!.episode.wasted!);
      expect(far.empty.length).toBeLessThan(near.empty.length);
      expect(far.empty.at(-1)!.want).toBe(0);
    });

    it("wants it again once the chest pays again", () => {
      const { tripToChest, empty } = emptied(NEAR);
      expect(empty.at(-1)!.want).toBe(0);
      let trips = 0;
      while (trips < 10 && tripToChest(4).want === 0) trips++;
      expect(trips).toBeLessThan(10);
    });

    it("with wasted effort off, only fades: after 30 empty trips the pull is faint but still there", () => {
      const { scorebook, expectedBefore, peak, empty } = emptied(NEAR, 0, 30);
      for (const trip of empty) expect(trip.episode.surprise).toBeLessThan(0);
      for (const trip of empty) expect(trip.episode.wasted).toBeUndefined();
      expect(scorebook.get(situation, "go_to", THE_CHEST).expected).toBeLessThan(0.1 * expectedBefore);
      expect(empty.at(-1)!.want).toBeLessThan(0.1 * peak);
      expect(empty.at(-1)!.want).toBeGreaterThan(0);
    });
  });

  describe("needs are signed: what goes round in a circle pays nothing", () => {
    type Logged = { rule: string; amount: number };
    const rewardsOf = (out: RegionOutput) => (out.trace?.rewards as Logged[] | undefined) ?? [];
    const sum = (outs: RegionOutput[], rule?: string) => outs.flatMap(rewardsOf).reduce((total, r) => (rule === undefined || r.rule === rule ? total + r.amount : total), 0);
    const episodeOf = (out: RegionOutput) => (out.trace?.episodes as { skill: string; outcome: number }[])[0]!;
    const cow = (id: number, type: string) => ({ id: `entity:${id}`, type, dist: 5, hostile: false, reachable: true });
    const husk = (dist: number) => ({ id: "entity:9", type: "husk", dist, hostile: true, reachable: true });

    it("idling while a wound mends earns nothing overall: the hurt cost what the healing pays", () => {
      const { tick } = bot();
      tick({}, [{ skill: "idle", type: "started" }]);
      const outs = [tick({ health: 12 }), tick({ health: 14 }), tick({ health: 17 }), tick({ health: 20 })];
      expect(rewardsOf(outs[0]!)[0]).toMatchObject({ rule: "health" });
      expect(rewardsOf(outs[0]!)[0]!.amount).toBeLessThan(0);
      expect(sum(outs, "health")).toBeCloseTo(0);
      expect(episodeOf(tick({}, [{ skill: "idle", type: "interrupted" }])).outcome).toBeCloseTo(0);
    });

    it("dropping a sword and picking it up again, over and over, earns nothing", () => {
      const { tick } = bot();
      const sword = { inventory: { stone_sword: 1 } };
      const first = tick(sword);
      expect(sum([first], "tools")).toBeGreaterThan(0);
      const rounds = Array.from({ length: 4 }, () => [tick({}), tick(sword)]).flat();
      expect(sum(rounds, "tools")).toBeCloseTo(0);
    });

    it("a threat that comes and goes while the bot stands by earns nothing", () => {
      const { tick } = bot();
      tick({}, [{ skill: "idle", type: "started" }]);
      const outs = [tick({ mobs: [husk(2)] }), tick({ mobs: [husk(2)] }), tick({})];
      expect(sum(outs, "danger")).toBeCloseTo(0);
    });

    it("running from a threat is paid all the way out, as much as killing it where it stood", () => {
      const fled = bot();
      fled.tick({ mobs: [husk(2)] });
      fled.tick({ mobs: [husk(2)] }, [{ skill: "flee", type: "started" }]);
      const flight = [fled.tick({ mobs: [husk(4)], x: 3 }), fled.tick({ mobs: [husk(6)], x: 6 }), fled.tick({ x: 9 }, [{ skill: "flee", type: "done" }])];
      for (const out of flight) expect(sum([out], "danger")).toBeGreaterThan(0);

      const fought = bot();
      fought.tick({ mobs: [husk(2)] });
      fought.tick({ mobs: [husk(2)] }, [{ skill: "attack", type: "started" }]);
      const kill = fought.tick({}, [{ skill: "attack", type: "done" }]);
      expect(sum(flight, "danger")).toBeCloseTo(sum([kill], "danger"));
      expect(episodeOf(flight[2]!).outcome).toBeGreaterThan(0.5);
    });

    it("dying hungry and hurt beside a threat is a loss, however full the new life starts", () => {
      const { tick } = bot();
      tick({ food: 7, health: 12, mobs: [husk(3)] });
      const outs = [tick({ food: 7, health: 0, mobs: [husk(3)] }), tick({ food: 20, health: 20, deaths: 1, x: 300, inventory: { bed: 1 } }), tick({ food: 20, health: 20, deaths: 1, x: 300, inventory: { bed: 1 } })];
      for (const r of outs.slice(1).flatMap(rewardsOf)) expect(r.amount).toBeLessThanOrEqual(0);
      expect(sum(outs, "died")).toBe(-1);
      expect(sum(outs)).toBeLessThan(-1);
    });

    it("a crowd of new animals pays an idle bot no more than its boredom had cost", () => {
      const { tick, wait } = bot();
      tick({}, [{ skill: "idle", type: "started" }]);
      const dull: RegionOutput[] = [];
      for (let i = 0; i < 60; i++) {
        wait(10_000); // ten quiet minutes in all
        dull.push(tick());
      }
      expect(sum(dull, "novelty")).toBeLessThan(0);
      const kinds = ["cow", "pig", "sheep", "chicken", "rabbit", "horse"];
      const crowd = kinds.map((_, i) => tick({ mobs: kinds.slice(0, i + 1).map((type, n) => cow(n, type)) }));
      expect(sum(crowd, "novelty")).toBeGreaterThan(0);
      expect(sum(crowd, "novelty")).toBeLessThanOrEqual(1);
      expect(sum([...dull, ...crowd], "novelty")).toBeLessThan(0.3);
    });
  });

  describe("what is learned carries over", () => {
    const OTHER_CHEST = "pos:-9,63,0";
    const cuesOf = (out: RegionOutput) => (out.trace?.cues as { thing: { id: string }; want: number }[] | undefined) ?? [];

    it("still wants the chest when the situation changes (fed), having only learned it while hungry", () => {
      const { tripToChest, tick } = bot();
      for (let i = 0; i < 5; i++) tripToChest(4);
      expect(situationOf(state({ food: 20 }, 0))).not.toBe(situation);
      tick({ food: 20 });
      expect(cuesOf(tick({ food: 20 }))).toMatchObject([{ thing: { id: CHEST } }]);
    });

    it("wants this chest more than chests in general: a trip aimed at another chest starts from the kind alone", () => {
      const { scorebook, tripToChest } = bot();
      for (let i = 0; i < 5; i++) tripToChest(4);
      const here = scorebook.aimed("go_to", THE_CHEST).expected;
      const elsewhere = scorebook.aimed("go_to", { kind: "chest", id: OTHER_CHEST }).expected;
      expect(elsewhere).toBeGreaterThan(0);
      expect(here).toBeGreaterThan(1.5 * elsewhere);
    });
  });

  describe("death guardrail", () => {
    it("teaches the skill that was running a large negative surprise", () => {
      const { scorebook, tick } = bot();
      tick({}, [{ skill: "go_to", target: CHEST, type: "started" }]);
      tick({ deaths: 1 });
      const out = tick({ deaths: 1 }, [{ skill: "go_to", type: "interrupted" }]);
      expect(out.trace?.episodes).toMatchObject([{ skill: "go_to", fatal: true, outcome: DEATH_OUTCOME }]);
      expect(scorebook.get(situation, "go_to").expected).toBeCloseTo(0.19 * DEATH_OUTCOME); // the skill and its labels
      expect(scorebook.get(situation, "go_to", THE_CHEST).expected).toBeCloseTo((1 - 0.9 ** 4) * DEATH_OUTCOME); // and the chest
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

  describe("the hypothalamus: one shared reading of the needs", () => {
    /** The same day lived twice: with the hypothalamus reading the needs, and with it left out. */
    function live(withHypothalamus: boolean, settings = DRIVES_OFF) {
      const store = createWorkspace();
      const regions = [
        ...(withHypothalamus ? [createHypothalamusRegion({ needs: playerNeeds, settings, dayTime: playerDayTime })] : []),
        createPlayerDopamine({ scorebook: createScorebook(), novelty: createNoveltyMemory(), personality: DEFAULT_PERSONALITY, skillsToward: () => ["go_to"] }),
        createNoradrenalineRegion({ needs: needsNow, settings: DEFAULT_NORADRENALINE }),
        createPatienceRegion({ needs: needsNow, settings: DEFAULT_PATIENCE }),
      ];
      const husk = (dist: number) => ({ id: "entity:9", type: "husk", dist, hostile: true, reachable: true });
      const day: [Patch, Omit<SkillEvent, "timestamp">[]][] = [
        [{}, []],
        [{}, []],
        [{ foodItems: 0 }, [{ skill: "go_to", target: CHEST, type: "started" }]],
        [{ foodItems: 0, x: 3 }, []],
        [{ foodItems: 4, x: 6 }, [{ skill: "go_to", type: "done" }]],
        [{ foodItems: 4, food: 6 }, []],
        [{ foodItems: 3, food: 12 }, []],
        [{ foodItems: 3, food: 12, mobs: [husk(6)] }, []],
        [{ foodItems: 3, food: 12, health: 14, mobs: [husk(2)] }, [{ skill: "flee", type: "started" }]],
        [{ foodItems: 3, food: 12, health: 14, x: 12, mobs: [husk(9)] }, []],
        [{ foodItems: 3, food: 12, health: 14, x: 20 }, [{ skill: "flee", type: "done" }]],
        [{ foodItems: 0, food: 12, health: 16, x: 20 }, []],
        [{ foodItems: 0, food: 12, health: 20, deaths: 1 }, []],
        [{ foodItems: 0 }, []],
      ];
      let now = 0;
      return day.map(([patch, events]) => {
        for (const e of events) store.addEvent({ ...e, timestamp: now });
        now += 500;
        store.update(state(patch, now), null);
        const outs = regions.map((region) => region.run(store.viewFor(region.name), signal) as RegionOutput);
        const [dopamine, noradrenaline, serotonin] = outs.slice(-3) as [RegionOutput, RegionOutput, RegionOutput];
        // Everything the needs feed: rewards and what was learned, cues and proposals, alarm, search, the outlook and patience.
        return { rewards: dopamine.trace?.rewards, episodes: dopamine.trace?.episodes, cues: dopamine.trace?.cues, proposals: dopamine.proposals, alarm: noradrenaline.trace?.alarm, raisedBy: noradrenaline.trace?.raisedBy, search: noradrenaline.trace?.search, outlook: serotonin.trace?.outlook, patience: serotonin.trace?.patience, needs: serotonin.trace?.needs, shared: store.needs() !== null };
      });
    }

    it("gives the same rewards, wants, alarm, search and outlook with the region as with it left out", () => {
      const [withIt, without] = [live(true), live(false)];
      expect(withIt.every((t) => t.shared)).toBe(true);
      expect(without.some((t) => t.shared)).toBe(false);
      expect(withIt.map(({ shared: _shared, ...t }) => t)).toEqual(without.map(({ shared: _shared, ...t }) => t));
      // And the day had something in it to compare: needs were paid for, a threat raised alarm, the outlook moved.
      const rewards = withIt.flatMap((t) => (t.rewards as { rule: string }[] | undefined) ?? []).map((r) => r.rule);
      expect(rewards).toEqual(expect.arrayContaining(["food_stock", "food_bar", "health", "danger", "died"]));
      expect(Math.max(...withIt.map((t) => t.alarm as number))).toBeGreaterThan(0.5);
      expect(new Set(withIt.map((t) => t.outlook)).size).toBeGreaterThan(3);
    });

    it("with every drive on, each reward is still paid on the real level: looking ahead changes what is wanted, never what is paid", () => {
      const [ahead, plain] = [live(true, DEFAULT_DRIVES), live(true)];
      expect(ahead.map((t) => t.rewards)).toEqual(plain.map((t) => t.rewards));
      expect(ahead.map((t) => t.episodes)).toEqual(plain.map((t) => t.episodes));
    });
  });
});
