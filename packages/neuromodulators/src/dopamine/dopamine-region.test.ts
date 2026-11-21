import type { SkillEvent, State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { describe, expect, it } from "vitest";
import { BLAME_WINDOW_MS, createDopamineRegion, DEATH_OUTCOME, SITUATION } from "./dopamine-region.js";
import type { RewardRule } from "./rewards.js";
import { createScorebook } from "./scorebook.js";
import { reliefOf } from "./wanting.js";
import { MAX_WASTE } from "./wasted.js";

const state = (tick: number): State => ({ schemaVersion: 1, tick, timestamp: tick, data: { food: tick } });
/** Even ticks are day, odd ticks night. */
const situationOf = (s: State) => (s.tick % 2 ? "night" : "day");
const signal = new AbortController().signal;

/** Rewards the food going up, and echoes how many new events it saw. */
const fed: RewardRule = {
  name: "fed",
  need: "hunger",
  check: ({ before, after, events }) => {
    const gained = (after.data.food as number) - (before.data.food as number);
    return gained > 0 ? { amount: gained, reason: `${events.length} events` } : null;
  },
};
const broken: RewardRule = {
  name: "broken",
  need: "hunger",
  check: () => {
    throw new Error("bad data");
  },
};

function setup(rules: RewardRule[]) {
  const store = createWorkspace();
  const scorebook = createScorebook();
  const region = createDopamineRegion({ rules, situationOf, scorebook });
  const tick = (n: number) => {
    store.update(state(n), null);
    return region.run(store.viewFor("dopamine"), signal);
  };
  return { store, scorebook, tick };
}

describe("createDopamineRegion", () => {
  it("runs every tick on the fastest layer", () => {
    expect(createDopamineRegion({ rules: [], situationOf })).toMatchObject({ name: "dopamine", layer: 0, everyMs: 0 });
  });

  it("logs nothing on the first tick, then the rewards since the last one", async () => {
    const { tick } = setup([fed]);
    expect(await tick(2)).toEqual({ proposals: [] });
    expect(await tick(5)).toEqual({
      proposals: [],
      trace: { situation: "night", rewards: [{ rule: "fed", need: "hunger", amount: 3, reason: "0 events" }], total: 3, mood: 0 },
    });
  });

  it("hands each skill event to the rules once", async () => {
    const { store, tick } = setup([fed]);
    const event: SkillEvent = { skill: "eat", type: "done", timestamp: 0 };
    await tick(1);
    store.addEvent(event);
    expect((await tick(2)).trace?.rewards).toMatchObject([{ reason: "1 events" }]);
    expect((await tick(3)).trace?.rewards).toMatchObject([{ reason: "0 events" }]);
  });

  it("learns from a finished skill's surprise, filed under the situation it started in", async () => {
    const { store, scorebook, tick } = setup([fed]);
    scorebook.learn("night", "eat", 0.5 / 0.19, 0.1); // expects 0.5 (two levels, a tenth each)
    await tick(1);
    store.addEvent({ skill: "eat", type: "started", timestamp: 0 });
    await tick(2); // started after tick 1 (night) chose it; rewards from here on are the episode's
    await tick(4);
    store.addEvent({ skill: "eat", type: "done", timestamp: 0 });
    const [episode] = (await tick(5)).trace?.episodes as Record<string, unknown>[];
    expect(episode).toMatchObject({ skill: "eat", situation: "night", outcome: 3, ended: "done", surprise: expect.closeTo(2.5, 2) });
    expect(episode).toMatchObject(scorebook.get("night", "eat"));
    expect(scorebook.get("night", "eat").expected).toBeCloseTo(0.5 + 2.5 * 0.19, 2); // two levels, a tenth each
  });

  it("counts how each skill run ended: done and failed, but not interrupted", async () => {
    const { store, scorebook, tick } = setup([]);
    await tick(0);
    for (const [i, type] of (["done", "failed", "interrupted"] as const).entries()) {
      store.addEvent({ skill: "eat", type: "started", timestamp: 0 });
      await tick(2 * i + 2);
      store.addEvent({ skill: "eat", type, timestamp: 0 });
      await tick(2 * i + 4);
    }
    expect(scorebook.get("day", "eat")).toMatchObject({ runs: 2, successes: 1 });
  });

  it("shares this tick's positive reward as the reward signal", async () => {
    const { store, tick } = setup([fed]);
    await tick(2);
    await tick(2.5);
    expect(store.signals().reward?.value).toBe(0.5);
    await tick(2.5);
    expect(store.signals().reward?.value).toBe(0);
  });

  it("shares DA as the dopamine signal: at rest first, then up with reward", async () => {
    const { store, tick } = setup([fed]);
    await tick(2);
    expect(store.signals().dopamine).toMatchObject({ value: 0.5, source: "dopamine" });
    await tick(3);
    expect(store.signals().dopamine?.value).toBeCloseTo(0.62);
  });

  it("learns what a skill was aimed at, then proposes heading to that kind of thing when it is in view", async () => {
    let sleeping = false;
    const store = createWorkspace();
    const scorebook = createScorebook();
    // Hunger as a need with a level: none left at food 0, satisfied at food 10.
    const hunger: RewardRule = { ...fed, level: (s) => 1 - (s.data.food as number) / 10 };
    const region = createDopamineRegion({
      rules: [hunger],
      situationOf: () => "day",
      scorebook,
      thingsOf: () => [{ id: "pos:1,2,3", kind: "chest", fixed: true }],
      skillsToward: () => ["go_to"],
      asleep: () => sleeping,
    });
    const tick = (n: number) => {
      store.update(state(n), null);
      return region.run(store.viewFor("dopamine"), signal);
    };
    await tick(0);
    store.addEvent({ skill: "go_to", target: "pos:1,2,3", type: "started", timestamp: 0 });
    await tick(0);
    store.addEvent({ skill: "go_to", type: "done", timestamp: 0 });
    const out = await tick(5); // the trip to the chest paid off
    expect(out.trace?.episodes).toMatchObject([{ skill: "go_to", toward: "chest", towardId: "pos:1,2,3", outcome: 5 }]);
    expect(scorebook.aimed("go_to", { kind: "chest", id: "pos:1,2,3" }).expected).toBeGreaterThan(0.5);
    expect(scorebook.aimed("go_to", { kind: "chest", id: "pos:9,9,9" }).expected).toBeGreaterThan(0.3); // another chest: its kind alone
    // The trip brought hunger down by half, and it is still half hungry: it wants the chest for that.
    expect(out.trace?.episodes).toMatchObject([{ reliefs: { fed: 0.5 } }]);
    expect(scorebook.aimed(reliefOf("go_to", "fed"), { kind: "chest", id: "pos:1,2,3" }).expected).toBeGreaterThan(0);
    expect(out.proposals).toMatchObject([{ action: { skill: "go_to", target: "pos:1,2,3" }, reason: expect.stringMatching(/^wants the chest \(fed/) }]);
    expect(out.trace?.cues).toMatchObject([{ thing: { kind: "chest" }, skill: "go_to", needs: { fed: expect.any(Number) } }]);
    // Asleep, the cue is still noticed but proposes nothing: it is not a wake event.
    sleeping = true;
    const asleep = await tick(5);
    expect(asleep.proposals).toEqual([]);
    expect(asleep.trace?.cues).toHaveLength(1);
  });

  describe("death", () => {
    /** Kills the bot when the state's food reaches 99. */
    const death: RewardRule = {
      name: "died",
      need: "safety",
      check: ({ after }) => (after.data.food === 99 ? { amount: -1, reason: "died", fatal: true } : null),
    };
    const at = (food: number, timestamp: number): State => ({ schemaVersion: 1, tick: food, timestamp, data: { food } });

    function run() {
      const store = createWorkspace();
      const scorebook = createScorebook();
      const region = createDopamineRegion({ rules: [death], situationOf: () => "day", scorebook });
      const tick = (food: number, timestamp: number) => {
        store.update(at(food, timestamp), null);
        return region.run(store.viewFor("dopamine"), signal);
      };
      return { store, scorebook, tick };
    }

    it("teaches the running skill a large negative surprise", async () => {
      const { store, scorebook, tick } = run();
      await tick(0, 0);
      store.addEvent({ skill: "go_to", type: "started", timestamp: 0 });
      await tick(0, 1);
      await tick(99, 2);
      store.addEvent({ skill: "go_to", type: "interrupted", timestamp: 0 });
      const out = await tick(0, 3);
      expect(out.trace?.episodes).toMatchObject([{ skill: "go_to", outcome: DEATH_OUTCOME, fatal: true, surprise: DEATH_OUTCOME }]);
      expect(scorebook.get("day", "go_to").expected).toBeCloseTo(0.19 * DEATH_OUTCOME);
    });

    it("blames the skill that just ended when none is running", async () => {
      const { store, scorebook, tick } = run();
      await tick(0, 0);
      store.addEvent({ skill: "eat", type: "started", timestamp: 0 });
      await tick(0, 1);
      store.addEvent({ skill: "eat", type: "done", timestamp: 0 });
      await tick(0, 2);
      const out = await tick(99, 2 + BLAME_WINDOW_MS);
      expect(out.trace?.blamedForDeath).toMatchObject({ skill: "eat", outcome: DEATH_OUTCOME });
      expect(scorebook.get("day", "eat").expected).toBeLessThan(0);
    });

    it("blames nobody for a death long after the last skill", async () => {
      const { store, tick } = run();
      await tick(0, 0);
      store.addEvent({ skill: "eat", type: "started", timestamp: 0 });
      await tick(0, 1);
      store.addEvent({ skill: "eat", type: "done", timestamp: 0 });
      await tick(0, 2);
      expect((await tick(99, 3 + BLAME_WINDOW_MS)).trace?.blamedForDeath).toBeUndefined();
    });
  });

  describe("wasted effort", () => {
    /** A bot that works 0.05 a tick, and expects `expected` from "go_to" in general. */
    function working(expected: number, effort = 0.05) {
      const store = createWorkspace();
      const scorebook = createScorebook([{ feature: "go_to", expected, benefit: 1, cost: 1 }]);
      const region = createDopamineRegion({ rules: [fed], situationOf: () => "day", scorebook, effortOf: () => effort, thingsOf: () => [{ id: "c", kind: "chest", fixed: true }] });
      let now = 0;
      /** One tick; `food` is the food level, which only pays when it goes up. */
      const tick = (food = 0) => {
        store.update({ ...state(++now), data: { food } }, null);
        return region.run(store.viewFor("dopamine"), signal);
      };
      /** A run of go_to that works for `ticks` ticks (the last is the one it ends on, as `end`, with `found` food); that tick's trace. */
      const run = async (ticks: number, end: SkillEvent["type"] = "done", found = 0, target?: string) => {
        await tick();
        store.addEvent({ skill: "go_to", type: "started", timestamp: 0, ...(target ? { target } : {}) });
        for (let i = 0; i < ticks; i++) await tick(); // the first of these sees it start: no work yet
        store.addEvent({ skill: "go_to", type: end, timestamp: 0 });
        return (await tick(found)).trace!;
      };
      return { store, scorebook, run };
    }
    const episodeOf = (trace: Record<string, unknown>) => (trace.episodes as Record<string, unknown>[])[0]!;

    it("charges a run that was expected to pay and earned nothing, by the work it took", async () => {
      const { scorebook, run } = working(0.4);
      const trace = await run(2);
      expect(trace.rewards).toMatchObject([{ rule: "wasted_effort", need: "progress", amount: expect.closeTo(-0.1) }]);
      expect(trace.total).toBeCloseTo(-0.1);
      expect(episodeOf(trace)).toMatchObject({ outcome: expect.closeTo(-0.1), wasted: expect.closeTo(0.1), surprise: expect.closeTo(-0.5) });
      expect(scorebook.get("day", "go_to").expected).toBeCloseTo(0.4 - 0.5 * 0.19); // two levels, a tenth each
    });

    it("charges more for a longer run, up to a cap", async () => {
      const short = episodeOf(await working(0.4).run(2)).wasted as number;
      const long = episodeOf(await working(0.4).run(6)).wasted as number;
      expect(long).toBeCloseTo(3 * short);
      expect(episodeOf(await working(0.4, 1).run(5)).wasted).toBe(MAX_WASTE);
    });

    it("charges nothing when the run paid for its work, or no payoff was expected", async () => {
      const paid = await working(0.4).run(2, "done", 1);
      expect(paid.rewards).toMatchObject([{ rule: "fed" }]);
      expect(episodeOf(paid)).toMatchObject({ outcome: 1 });
      expect(episodeOf(paid)).not.toHaveProperty("wasted");

      const { scorebook, run } = working(0);
      expect((await run(3)).rewards).toEqual([]);
      expect(scorebook.get("day", "go_to").expected).toBe(0);
    });

    it("charges a failed run too, but not one that was interrupted", async () => {
      expect(episodeOf(await working(0.4).run(2, "failed")).wasted).toBeCloseTo(0.1);
      const cut = await working(0.4).run(2, "interrupted");
      expect(cut.rewards).toEqual([]);
      expect(episodeOf(cut)).toMatchObject({ surprise: 0, unfinished: expect.closeTo(0.4) }); // nor is it a disappointment
    });

    it("judges the run as a whole: the skill, here, aimed at that thing", async () => {
      // go_to in general expects nothing, but this chest has paid: only a trip to it can be wasted.
      const { scorebook, run } = working(0);
      scorebook.learn("day", "go_to", 2, 0.1, { kind: "chest", id: "c" });
      scorebook.learn("day", "go_to", -3, 0.1); // ... and going nowhere in particular has not
      expect(scorebook.get("day", "go_to").expected).toBeLessThan(0);
      expect(scorebook.get("day", "go_to", { kind: "chest", id: "c" }).expected).toBeGreaterThan(0);
      expect((await run(2)).rewards).toEqual([]);
      const trace = await run(2, "done", 0, "c");
      expect(trace.rewards).toMatchObject([{ rule: "wasted_effort", reason: expect.stringContaining("go_to to the chest") }]);
      expect(episodeOf(trace)).toMatchObject({ toward: "chest", towardId: "c", wasted: expect.closeTo(0.1) });
    });

    it("stops charging once nothing is expected any more, so the expectation settles below zero", async () => {
      const { scorebook, run } = working(0.005);
      await run(2);
      const after = scorebook.get("day", "go_to").expected;
      expect(after).toBeLessThan(0);
      expect((await run(1)).rewards).toEqual([]);
      expect(scorebook.get("day", "go_to").expected).toBeGreaterThan(after);
      expect(scorebook.get("day", "go_to").expected).toBeLessThan(0);
    });

    it("opens a learning window when the waste is big enough to be notable", async () => {
      const store = createWorkspace();
      const scorebook = createScorebook([{ feature: "go_to", expected: 0.4, benefit: 1, cost: 1 }]);
      const region = createDopamineRegion({ rules: [], situationOf: () => "day", scorebook, effortOf: () => 0.2, learningWindowMs: 2000 });
      const tick = (n: number) => {
        store.update(state(n), null);
        return region.run(store.viewFor("dopamine"), signal);
      };
      await tick(10_000);
      store.addEvent({ skill: "go_to", type: "started", timestamp: 0 });
      await tick(20_000);
      store.addEvent({ skill: "go_to", type: "done", timestamp: 0 });
      expect((await tick(30_000)).trace).toMatchObject({ learningWindow: "opened" });
      expect(scorebook.get("day", "go_to").expected).toBeCloseTo(0.4 + 0.19 * (-0.2 - 0.4)); // the full step, at both levels
    });
  });

  describe("a skill is judged on the difference it made", () => {
    /** Loses 0.3 on landing: the tick the state stops reading "falling". */
    const landing: RewardRule = {
      name: "landing",
      need: "safety",
      check: ({ before, after }) => (before.data.falling && !after.data.falling ? { amount: -0.3, reason: "landed hard" } : null),
    };
    /** A world where the state says whether the bot is falling; ticks are half a second apart. */
    function world(situationWorth?: number) {
      const store = createWorkspace();
      const scorebook = createScorebook();
      const region = createDopamineRegion({ rules: [landing, fed], situationOf: (s) => (s.data.falling ? "falling" : "steady"), scorebook, ...(situationWorth === undefined ? {} : { situationWorth }) });
      let now = 0;
      const tick = (data: { falling?: boolean; food?: number } = {}) => {
        now += 500;
        store.update({ schemaVersion: 1, tick: 0, timestamp: now, data: { falling: false, food: 0, ...data } }, null);
        return region.run(store.viewFor("dopamine"), signal);
      };
      const event = (skill: string, type: SkillEvent["type"]) => store.addEvent({ skill, type, timestamp: 0 });
      /** A fall with no skill running: two ticks in the air, a hard landing, then a quiet quarter of a minute. */
      const fall = async () => {
        await tick({ falling: true });
        await tick({ falling: true });
        for (let i = 0; i < 30; i++) await tick();
      };
      const episodes = (trace: Record<string, unknown> | undefined) => (trace?.episodes as Record<string, number | string>[] | undefined) ?? [];
      return { scorebook, tick, event, fall, episodes };
    }

    it("learns what a situation is worth by itself: falling comes before a hurt", async () => {
      const { scorebook, tick, fall } = world();
      await tick();
      for (let i = 0; i < 8; i++) await fall();
      const [falling, steady] = [scorebook.get("falling", SITUATION).expected, scorebook.get("steady", SITUATION).expected];
      expect(falling).toBeLessThan(-0.15);
      expect(falling).toBeLessThan(steady - 0.1); // standing still is worth more, though a fall is never far off in this world
      expect(steady).toBeLessThanOrEqual(0);
    });

    it("does not blame the skill that started mid-fall for the landing, and does blame the one that walked off", async () => {
      const { tick, event, fall, episodes } = world();
      await tick();
      for (let i = 0; i < 12; i++) await fall();
      // go_to walks off an edge; the righting reflex takes over in the air and the landing hurts as usual.
      event("go_to", "started");
      await tick();
      await tick({ falling: true });
      event("go_to", "interrupted");
      event("air_steer", "started");
      const cut = episodes((await tick({ falling: true })).trace);
      await tick(); // lands: -0.3 while air_steer runs
      event("air_steer", "done");
      const landed = episodes((await tick()).trace);
      expect(cut).toMatchObject([{ skill: "go_to" }]);
      expect(cut[0]!.shift).toBeLessThan(-0.15);
      expect(cut[0]!.surprise).toBeLessThan(-0.15); // it walked into the fall
      expect(landed).toMatchObject([{ skill: "air_steer" }]);
      expect(landed[0]!.shift).toBeGreaterThan(0.15);
      expect(Math.abs(landed[0]!.outcome as number)).toBeLessThan(0.15); // the hurt was already coming: -0.3, less what falling foretold
    });

    it("charges the reflex only for how much worse the landing was than falls foretell", async () => {
      const { tick, event, fall, episodes } = world();
      await tick();
      for (let i = 0; i < 12; i++) await fall();
      await tick({ falling: true });
      event("air_steer", "started");
      await tick({ falling: true });
      // It lands, as hard as ever, with the reflex running: -0.3, less the 0.15 or more that falling foretold.
      event("air_steer", "done");
      const saved = episodes((await tick({ falling: false })).trace);
      expect(saved).toMatchObject([{ skill: "air_steer" }]);
      expect(saved[0]!.outcome).toBeGreaterThan(-0.3 + 0.15);
    });

    it("puts a hurt that shows a moment after the fall is over down to falling, not to standing still", async () => {
      // As in the game: the body reads steady for a tick before the health drop is seen.
      const late: RewardRule = { name: "late", need: "safety", check: ({ after }) => (after.data.hurt ? { amount: -0.3, reason: "the landing shows" } : null) };
      const store = createWorkspace();
      const scorebook = createScorebook();
      const region = createDopamineRegion({ rules: [late], situationOf: (s) => (s.data.falling ? "falling" : "steady"), scorebook });
      let now = 0;
      const tick = (data: { falling?: boolean; hurt?: boolean } = {}) => {
        now += 200;
        store.update({ schemaVersion: 1, tick: 0, timestamp: now, data: { falling: false, hurt: false, ...data } }, null);
        return region.run(store.viewFor("dopamine"), signal);
      };
      await tick();
      for (let fall = 0; fall < 12; fall++) {
        for (let i = 0; i < 4; i++) await tick({ falling: true });
        await tick(); // down, and steady
        await tick({ hurt: true }); // ... and only now the hurt
        for (let i = 0; i < 60; i++) await tick();
      }
      const [falling, steady] = [scorebook.get("falling", SITUATION).expected, scorebook.get("steady", SITUATION).expected];
      expect(falling).toBeLessThan(-0.1);
      expect(falling).toBeLessThan(steady - 0.08);
    });

    it("with situation worth off, charges the skill for whatever happened while it ran", async () => {
      const { tick, event, fall, episodes } = world(0);
      await tick();
      for (let i = 0; i < 12; i++) await fall();
      await tick({ falling: true });
      event("air_steer", "started");
      await tick({ falling: true });
      await tick();
      event("air_steer", "done");
      const landed = episodes((await tick()).trace);
      expect(landed).toMatchObject([{ skill: "air_steer", outcome: expect.closeTo(-0.3) }]);
      expect(landed[0]).not.toHaveProperty("shift");
    });

    it("learns nothing from a run cut short before anything happened", async () => {
      const { scorebook, tick, event, episodes } = world();
      scorebook.learn("steady", "go_to", 0.5 / 0.19, 0.1); // expects 0.5
      await tick();
      event("go_to", "started");
      await tick();
      await tick();
      event("go_to", "interrupted");
      const cut = episodes((await tick()).trace);
      expect(cut).toMatchObject([{ skill: "go_to", ended: "interrupted", surprise: expect.closeTo(0), unfinished: expect.closeTo(0.5) }]);
      expect(scorebook.get("steady", "go_to").expected).toBeCloseTo(0.5);
    });

    it("still learns a loss, or a gain beyond what was expected, from a run cut short", async () => {
      const hurt = world();
      hurt.scorebook.learn("steady", "go_to", 0.5 / 0.19, 0.1);
      await hurt.tick();
      hurt.event("go_to", "started");
      await hurt.tick({ falling: true });
      await hurt.tick(); // lands hard while go_to runs
      hurt.event("go_to", "interrupted");
      const cut = hurt.episodes((await hurt.tick()).trace);
      expect(cut[0]!.surprise).toBeLessThan(-0.2);

      const lucky = world();
      lucky.scorebook.learn("steady", "go_to", 0.5 / 0.19, 0.1);
      await lucky.tick();
      lucky.event("go_to", "started");
      await lucky.tick();
      await lucky.tick({ food: 2 }); // found far more than expected on the way
      lucky.event("go_to", "interrupted");
      expect(lucky.episodes((await lucky.tick({ food: 2 })).trace)[0]).toMatchObject({ surprise: expect.closeTo(1.5), outcome: 2 });
    });
  });

  it("skips a rule that throws and records why", async () => {
    const { tick } = setup([broken, fed]);
    await tick(1);
    expect((await tick(2)).trace).toEqual({
      situation: "day",
      rewards: [{ rule: "fed", need: "hunger", amount: 1, reason: "0 events" }],
      total: 1,
      mood: 0,
      errors: { broken: "bad data" },
    });
  });

  describe("learning window", () => {
    /** Runs eat for one tick with `gain` food arriving, optionally with a window. Returns what was learned. */
    async function learnFrom(gain: number, window: { learningWindowMs: number; notable?: () => boolean } | null) {
      const store = createWorkspace();
      const scorebook = createScorebook();
      scorebook.learn("day", "eat", 1 / 0.19, 0.1); // expects 1 (two levels, a tenth each)
      const region = createDopamineRegion({ rules: [fed], situationOf: () => "day", scorebook, ...(window ?? {}) });
      const at = (food: number, ms: number): State => ({ schemaVersion: 1, tick: 0, timestamp: ms, data: { food } });
      const tick = (food: number, ms: number) => {
        store.update(at(food, ms), null);
        return region.run(store.viewFor("dopamine"), signal);
      };
      await tick(0, 0);
      store.addEvent({ skill: "eat", type: "started", timestamp: 0 });
      await tick(0, 500);
      store.addEvent({ skill: "eat", type: "done", timestamp: 0 });
      const out = await tick(gain, 1000);
      return { expected: scorebook.get("day", "eat").expected, trace: out.trace! };
    }

    it("applies the full update inside a window opened by a notable reward", async () => {
      const { expected, trace } = await learnFrom(3, { learningWindowMs: 2000 });
      expect(trace.learningWindow).toBe("opened");
      expect(expected).toBeCloseTo(1 + 0.19 * (3 - 1));
    });

    it("applies only a fifth of the update outside a window", async () => {
      const { expected, trace } = await learnFrom(0, { learningWindowMs: 2000 }); // nothing notable happened
      expect(trace.learnedOutsideWindow).toBe(true);
      expect(expected).toBeCloseTo(1 + (1 - 0.98 ** 2) * (0 - 1));
    });

    it("lets something else notable (an alarm jump, a cue) open the window", async () => {
      const { expected } = await learnFrom(0, { learningWindowMs: 2000, notable: () => true });
      expect(expected).toBeCloseTo(1 + 0.19 * (0 - 1));
    });

    it("always learns in full when no window is set", async () => {
      const { expected, trace } = await learnFrom(0, null);
      expect(expected).toBeCloseTo(0.81);
      expect(trace.learnedOutsideWindow).toBeUndefined();
    });
  });

  describe("wanting: what a run does to each need", () => {
    const CHEST = { id: "pos:1,2,3", kind: "chest", fixed: true };
    const AIM = { kind: "chest", id: CHEST.id };
    /** Hunger as a need: none left at food 0, satisfied at food 10. Pays the signed change like any need. */
    const hunger: RewardRule = {
      name: "hunger",
      need: "hunger",
      level: (s) => 1 - (s.data.food as number) / 10,
      check: ({ before, after }) => {
        const [was, now] = [1 - (before.data.food as number) / 10, 1 - (after.data.food as number) / 10];
        return was === now ? null : { amount: was * was - now * now, reason: "food" };
      },
    };
    function hungryBot() {
      const store = createWorkspace();
      const scorebook = createScorebook();
      const region = createDopamineRegion({ rules: [hunger], situationOf: () => "day", scorebook, thingsOf: () => [CHEST], skillsToward: () => ["go_to"] });
      let now = 0;
      const tick = async (food: number) => {
        now += 100;
        store.update({ schemaVersion: 1, tick: now, timestamp: now, data: { food } }, null);
        return region.run(store.viewFor("dopamine"), signal);
      };
      /** One trip to the chest: food goes from `from` to `to`, and the trip ends as `ended`. */
      const trip = async (from: number, to: number, ended: "done" | "interrupted" | "failed" = "done") => {
        await tick(from);
        store.addEvent({ skill: "go_to", target: CHEST.id, type: "started", timestamp: now });
        await tick(from);
        store.addEvent({ skill: "go_to", type: ended, timestamp: now });
        return tick(to);
      };
      const relief = () => scorebook.get("day", reliefOf("go_to", "hunger"), AIM).expected;
      /** How strongly the chest is wanted at this food level, `afterMs` from now (to be past any wait to try again). */
      const urgency = async (food: number, afterMs = 0) => {
        now += afterMs;
        return (await tick(food)).proposals[0]?.urgency ?? 0;
      };
      return { scorebook, tick, trip, relief, urgency };
    }

    it("learns how far a trip brought the need down, and wants the thing as much as the need presses", async () => {
      const { trip, relief, urgency } = hungryBot();
      for (let i = 0; i < 10; i++) await trip(0, 5);
      expect(relief()).toBeGreaterThan(0.4);
      const [starving, peckish, full] = [await urgency(0), await urgency(8), await urgency(10)];
      expect(starving).toBeGreaterThan(0.5);
      expect(peckish).toBeGreaterThan(0);
      expect(peckish).toBeLessThan(0.1);
      expect(full).toBe(0);
    });

    it("learns nothing about the chest from a trip made with the need already met", async () => {
      const { trip, relief } = hungryBot();
      for (let i = 0; i < 10; i++) await trip(0, 5);
      const known = relief();
      for (let i = 0; i < 10; i++) await trip(10, 10);
      expect(relief()).toBe(known);
      // Hungry, and it gave nothing: that does say the chest is empty.
      await trip(0, 0);
      expect(relief()).toBeLessThan(known);
    });

    it("trusts a run cut short less each time in a row, so one that never finishes is given up on", async () => {
      const { scorebook, trip, relief, urgency } = hungryBot();
      for (let i = 0; i < 10; i++) await trip(0, 5);
      const [known, expected] = [relief(), scorebook.get("day", "go_to", AIM).expected];
      // Once: nothing is learned from it.
      expect(await trip(0, 0, "interrupted")).toMatchObject({ trace: { episodes: [{ ended: "interrupted", unfinished: expect.any(Number) }] } });
      expect(relief()).toBeCloseTo(known);
      expect(scorebook.get("day", "go_to", AIM).expected).toBeCloseTo(expected);
      // Again and again: the trust falls, and with it what the chest is expected to give.
      const wanted = [await urgency(0, 61_000)];
      for (let i = 0; i < 25; i++) {
        const out = await trip(0, 0, "interrupted");
        expect(out.trace?.episodes).toMatchObject([{ trust: expect.any(Number) }]);
        wanted.push(await urgency(0, 61_000));
      }
      for (let i = 2; i < wanted.length; i++) expect(wanted[i]).toBeLessThanOrEqual(wanted[i - 1]!);
      expect(wanted.at(-1)).toBeLessThan(0.1 * wanted[0]!);
      expect(scorebook.get("day", "go_to", AIM).expected).toBeLessThan(0.2 * expected);
    });

    it("a run that failed did not finish either: one failure teaches nothing about the chest, many in a row do", async () => {
      const { scorebook, trip, relief } = hungryBot();
      for (let i = 0; i < 10; i++) await trip(0, 5);
      const known = relief();
      // No path to it, say: the bot never got there, so the chest has shown nothing.
      expect(await trip(0, 0, "failed")).toMatchObject({ trace: { episodes: [{ ended: "failed", unfinished: expect.any(Number) }] } });
      expect(relief()).toBeCloseTo(known);
      // Nine in a row used to leave under 3% of it; now about a fifth is left (and the waits between
      // tries, see the next test, spread those nine over minutes, not seconds).
      for (let i = 0; i < 8; i++) await trip(0, 0, "failed");
      expect(relief()).toBeGreaterThan(0.15 * known);
      expect(relief()).toBeLessThan(known);
      expect(scorebook.cutShort("go_to", AIM)).toBe(9);
    });

    it("a want that was just thwarted waits before it is tried again, longer each time in a row, and a finished run ends the wait", async () => {
      const { trip, urgency } = hungryBot();
      for (let i = 0; i < 10; i++) await trip(0, 5);
      expect(await urgency(0)).toBeGreaterThan(0.5);
      await trip(0, 0, "failed");
      expect(await urgency(0)).toBe(0); // at once: not again
      expect(await urgency(0, 1000)).toBeGreaterThan(0.5); // a second later: again
      await trip(0, 0, "interrupted");
      await trip(0, 0, "failed");
      expect(await urgency(0, 3000)).toBe(0); // the third in a row waits four seconds
      expect(await urgency(0, 1000)).toBeGreaterThan(0.3);
      await trip(0, 5);
      await trip(0, 0, "failed");
      expect(await urgency(0, 1000)).toBeGreaterThan(0.3); // a finished run between: back to one second
    });

    it("trusts it in full again after a run that finished", async () => {
      const { scorebook, trip } = hungryBot();
      for (let i = 0; i < 10; i++) await trip(0, 5);
      for (let i = 0; i < 6; i++) await trip(0, 0, "interrupted");
      await trip(0, 5);
      const expected = scorebook.get("day", "go_to", AIM).expected;
      const out = await trip(0, 0, "interrupted");
      expect((out.trace?.episodes as { trust?: number }[])[0]!.trust).toBeUndefined();
      expect(scorebook.get("day", "go_to", AIM).expected).toBeCloseTo(expected);
    });
  });
});
