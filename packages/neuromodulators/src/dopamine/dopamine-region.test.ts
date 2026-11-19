import type { SkillEvent, State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { describe, expect, it } from "vitest";
import { BLAME_WINDOW_MS, createDopamineRegion, DEATH_OUTCOME } from "./dopamine-region.js";
import type { RewardRule } from "./rewards.js";
import { createScorebook } from "./scorebook.js";

const state = (tick: number): State => ({ schemaVersion: 1, tick, timestamp: tick, data: { food: tick } });
/** Even ticks are day, odd ticks night. */
const situationOf = (s: State) => (s.tick % 2 ? "night" : "day");
const signal = new AbortController().signal;

/** Rewards the food going up, and echoes how many new events it saw. Never habituates. */
const fed: RewardRule = {
  name: "fed",
  need: "hunger",
  habituates: false,
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
    scorebook.learn("night", "eat", 5, 0.1); // expects 0.5
    await tick(1);
    store.addEvent({ skill: "eat", type: "started", timestamp: 0 });
    await tick(2); // started after tick 1 (night) chose it; rewards from here on are the episode's
    await tick(4);
    store.addEvent({ skill: "eat", type: "done", timestamp: 0 });
    const [episode] = (await tick(5)).trace?.episodes as Record<string, unknown>[];
    expect(episode).toMatchObject({ skill: "eat", situation: "night", outcome: 3, ended: "done", surprise: 2.5 });
    expect(episode).toMatchObject(scorebook.get("night", "eat"));
    expect(scorebook.get("night", "eat").expected).toBeCloseTo(0.75);
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
    const region = createDopamineRegion({
      rules: [fed],
      situationOf: () => "day",
      scorebook,
      thingsOf: () => [{ id: "pos:1,2,3", kind: "chest" }],
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
    expect(out.trace?.episodes).toMatchObject([{ skill: "go_to", toward: "chest", outcome: 5 }]);
    expect(scorebook.get("day", "go_to→chest").expected).toBeCloseTo(0.5);
    expect(out.proposals).toMatchObject([{ action: { skill: "go_to", target: "pos:1,2,3" }, reason: expect.stringMatching(/^wants the chest/) }]);
    expect(out.trace?.cues).toMatchObject([{ thing: { kind: "chest" }, skill: "go_to" }]);
    // Asleep, the cue is still noticed but proposes nothing: it is not a wake event.
    sleeping = true;
    const asleep = await tick(5);
    expect(asleep.proposals).toEqual([]);
    expect(asleep.trace?.cues).toHaveLength(1);
  });

  it("shrinks repeated rewards from the same rule, and logs the raw amount", async () => {
    const { tick } = setup([{ ...fed, habituates: true }]);
    await tick(1);
    expect((await tick(2)).trace?.rewards).toEqual([{ rule: "fed", need: "hunger", amount: 1, reason: "0 events" }]);
    expect((await tick(3)).trace?.rewards).toMatchObject([{ amount: expect.closeTo(0.5, 2), raw: 1, repeats: 1 }]);
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
      expect(scorebook.get("day", "go_to").expected).toBeCloseTo(0.1 * DEATH_OUTCOME);
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
      scorebook.learn("day", "eat", 10, 0.1); // expects 1
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
      expect(expected).toBeCloseTo(1 + 0.1 * (3 - 1));
    });

    it("applies only a fifth of the update outside a window", async () => {
      const { expected, trace } = await learnFrom(0, { learningWindowMs: 2000 }); // nothing notable happened
      expect(trace.learnedOutsideWindow).toBe(true);
      expect(expected).toBeCloseTo(1 + 0.02 * (0 - 1));
    });

    it("lets something else notable (an alarm jump, a cue) open the window", async () => {
      const { expected } = await learnFrom(0, { learningWindowMs: 2000, notable: () => true });
      expect(expected).toBeCloseTo(1 + 0.1 * (0 - 1));
    });

    it("always learns in full when no window is set", async () => {
      const { expected, trace } = await learnFrom(0, null);
      expect(expected).toBeCloseTo(0.9);
      expect(trace.learnedOutsideWindow).toBeUndefined();
    });
  });
});
