import { describe, expect, it } from "vitest";
import { createWorkspace } from "@familiar/core";
import { comfortOf, createFelt, FELT_AT, GONE_UNDER, type Reading } from "./felt.js";
import { createInsulaRegion, type InsulaOptions } from "./insula-region.js";
import { feelingLine } from "./line.js";
import { createMood, MOOD_FADE_MS } from "./mood.js";
import { DEFAULT_INSULA, insulaProblem, NO_INSULA, told } from "./settings.js";
import { createUnease, MARGIN, WINDOW_MS } from "./unease.js";

const reading = (word: string, level: number): Reading => ({ word, level, from: word });
const none = () => null;

describe("the list of feelings", () => {
  it("each reading that passes the level gives its word, strongest first", () => {
    const felt = createFelt();
    expect(felt([reading("hungry", 0.3), reading("hurting", 0.8), reading("cold", 0.1)])).toEqual([{ word: "hurting", strength: 0.8, from: "hurting" }, { word: "hungry", strength: 0.3, from: "hungry" }]);
    expect(felt([])).toEqual([]);
  });

  it("does not flicker: a feeling appears at the level and goes only well below it", () => {
    const felt = createFelt();
    const words = (level: number) => felt([reading("hungry", level)]).map((f) => f.word);
    expect(words(FELT_AT - 0.01)).toEqual([]);
    expect(words(FELT_AT)).toEqual(["hungry"]);
    // Hovering just under the level it came in at: still felt.
    for (const level of [0.24, 0.2, 0.26, 0.16, 0.24]) expect(words(level)).toEqual(["hungry"]);
    expect(words(GONE_UNDER - 0.01)).toEqual([]);
    // And it does not come back until it passes the level again.
    expect(words(0.2)).toEqual([]);
  });

  it("comfort is pulled down mostly by the strongest feeling, a little by the rest", () => {
    expect(comfortOf([])).toBe(1);
    expect(comfortOf([{ strength: 0.6 }])).toBeCloseTo(0.4);
    expect(comfortOf([{ strength: 0.6 }, { strength: 0.4 }])).toBeCloseTo(0.3);
    expect(comfortOf([{ strength: 1 }, { strength: 1 }])).toBe(0);
  });
});

describe("the feeling line", () => {
  const feeling = (feelings: [string, number][], more: { mood?: number; uneasy?: number } = {}) => ({ feelings: feelings.map(([word, strength]) => ({ word, strength, from: word })), mood: more.mood ?? 0, uneasy: { level: more.uneasy ?? 0, about: [] } });

  it("says each feeling with its degree, then unease, then a mood far from even", () => {
    expect(feelingLine(feeling([["hungry", 0.8], ["hurting", 0.3]], { uneasy: 0.5 }))).toBe("very hungry, a little hurting, uneasy");
    expect(feelingLine(feeling([["tired", 0.5]], { mood: -0.5 }))).toBe("tired, in low spirits");
    expect(feelingLine(feeling([], { mood: 0.4 }))).toBe("at ease, in good spirits");
  });

  it("says at ease when nothing is felt, and never names what is not there", () => {
    expect(feelingLine(feeling([]))).toBe("at ease");
    expect(feelingLine(feeling([], { uneasy: 0.9 }))).toBe("very uneasy");
    expect(feelingLine(feeling([["cold", 0.3]], { uneasy: 0.1, mood: 0.2 }))).toBe("a little cold");
  });
});

describe("mood", () => {
  it("moves slowly: a bad minute barely shifts it, a bad half hour does", () => {
    const mood = createMood();
    mood.feel(1, null, 0);
    for (let at = 500; at <= 60_000; at += 500) mood.feel(0, null, at);
    expect(mood.level()).toBeGreaterThan(-0.12);
    expect(mood.level()).toBeLessThan(0);
    for (let at = 60_500; at <= 6 * MOOD_FADE_MS; at += 500) mood.feel(0, null, at);
    expect(mood.level()).toBeLessThan(-0.45);
  });

  it("takes in surprises, good and bad, and lets them fade", () => {
    const mood = createMood();
    mood.feel(0.5, null, 0);
    expect(mood.feel(0.5, 0.8, 1000)).toBeCloseTo(0.4);
    expect(mood.feel(0.5, -0.8, 2000)).toBeCloseTo(0, 1);
    const later = createMood();
    later.feel(0.5, null, 0);
    later.feel(0.5, -1, 1000);
    expect(later.feel(0.5, null, 1000 + 5 * MOOD_FADE_MS)).toBeGreaterThan(-0.01);
  });
});

describe("unease", () => {
  it("rises for a change nothing explains, and names the reading", () => {
    const unease = createUnease();
    for (let at = 0; at <= 5000; at += 500) expect(unease.tick({ health: 1, food: 1 }, none, at)).toEqual({ level: 0, about: [] });
    const felt = unease.tick({ health: 0.7, food: 1 }, none, 5500);
    expect(felt.about).toEqual(["health"]);
    expect(felt.level).toBeCloseTo(1);
    // A smaller unexplained loss is a smaller unease.
    const mild = createUnease();
    mild.tick({ health: 1 }, none, 0);
    expect(mild.tick({ health: 0.85 }, none, 500).level).toBeCloseTo((0.15 - MARGIN) / 0.2);
  });

  it("does not rise for a change with a known cause, each way on its own", () => {
    const unease = createUnease();
    const explains = (name: string, change: number) => (name === "health" && change < 0 ? "a hit" : name === "food" && change > 0 ? "a meal" : null);
    unease.tick({ health: 1, food: 0.5 }, explains, 0);
    expect(unease.tick({ health: 0.6, food: 0.9 }, explains, 500)).toEqual({ level: 0, about: [] });
    // It stays quiet afterwards: the new level is where the reading now starts from.
    expect(unease.tick({ health: 0.6, food: 0.9 }, none, 1000).level).toBe(0);
    // A hit explains health falling, not food falling.
    expect(unease.tick({ health: 0.6, food: 0.5 }, none, 20_000).about).toEqual(["food"]);
  });

  it("a cause still explains the change that shows up just as it ends, and not one long after", () => {
    const hunger = (name: string, change: number) => (name === "food" && change < 0 ? "the hunger effect" : null);
    const unease = createUnease();
    unease.tick({ food: 1 }, hunger, 0);
    unease.tick({ food: 0.7 }, hunger, 500);
    // The effect is gone this tick, and its last three points show now.
    expect(unease.tick({ food: 0.55 }, none, 1000).level).toBe(0);
    expect(unease.tick({ food: 0.3 }, none, 10_000).about).toEqual(["food"]);
  });

  it("one point lost is ordinary; it fades once the change is half a minute old; a steady drift is what the reading does", () => {
    const one = createUnease();
    one.tick({ food: 1 }, none, 0);
    expect(one.tick({ food: 0.95 }, none, 500).level).toBe(0);
    const fades = createUnease();
    fades.tick({ health: 1 }, none, 0);
    expect(fades.tick({ health: 0.7 }, none, 500).level).toBeGreaterThan(0);
    expect(fades.tick({ health: 0.7 }, none, 500 + WINDOW_MS + 1000).level).toBe(0);
    // Food that has been falling steadily for ten minutes is no surprise when it goes on falling.
    const drift = createUnease();
    let level = 1;
    let worst = 0;
    for (let at = 0; at <= 900_000; at += 500) {
      level = Math.max(0, 1 - at / 1_200_000);
      const felt = drift.tick({ food: level }, none, at).level;
      if (at > 600_000) worst = Math.max(worst, felt);
    }
    expect(worst).toBe(0);
  });
});

describe("the insula region", () => {
  const signal = new AbortController().signal;
  function setUp(more: Partial<InsulaOptions> = {}) {
    const store = createWorkspace();
    let readings: Reading[] = [];
    let body: Record<string, number> = { health: 1 };
    const region = createInsulaRegion({ settings: DEFAULT_INSULA, readings: () => readings, body: () => body, ...more });
    let ms = 0;
    const tick = (now: { readings?: Reading[]; body?: Record<string, number> } = {}, afterMs = 500) => {
      ms += afterMs;
      readings = now.readings ?? readings;
      body = now.body ?? body;
      store.update({ schemaVersion: 1, tick: 0, timestamp: ms, data: {} }, null);
      const out = region.run(store.viewFor("insula"), signal) as { proposals: unknown[]; trace?: Record<string, any> };
      return { ...out, feeling: store.feeling() };
    };
    return { store, tick };
  }

  it("writes the feeling to the workspace, proposes nothing, and traces what set each feeling", () => {
    const i = setUp();
    const { feeling, proposals, trace } = i.tick({ readings: [reading("hungry", 0.8), reading("hurting", 0.3)] });
    expect(proposals).toEqual([]);
    expect(feeling).toMatchObject({ feelings: [{ word: "hungry", strength: 0.8, from: "hungry" }, { word: "hurting", strength: 0.3 }], uneasy: { level: 0, about: [] }, line: "very hungry, a little hurting" });
    expect(feeling!.comfort).toBeCloseTo(1 - 0.8 - 0.25 * 0.3);
    expect(trace).toMatchObject({ line: "very hungry, a little hurting", feelings: [{ word: "hungry", from: "hungry" }, { word: "hurting" }] });
    expect(i.tick({ readings: [] }).feeling).toMatchObject({ feelings: [], comfort: 1, line: "at ease" });
  });

  it("is uneasy when the body changes with no cause, and not when the cause is known", () => {
    const i = setUp();
    i.tick();
    const { feeling, trace } = i.tick({ body: { health: 0.7 } });
    expect(feeling).toMatchObject({ uneasy: { about: ["health"] }, line: "very uneasy" });
    expect(trace!.uneasy).toEqual({ level: 1, about: ["health"] });
    const explained = setUp({ explains: () => "a hit" });
    explained.tick();
    expect(explained.tick({ body: { health: 0.7 } }).feeling).toMatchObject({ uneasy: { level: 0 }, line: "at ease" });
  });

  it("each part has its own strength, and with feeling off nothing is written at all", () => {
    const half = setUp({ settings: { ...DEFAULT_INSULA, uneasy: 0.5, mood: 0 }, surpriseOf: () => -1 });
    half.tick();
    expect(half.tick({ body: { health: 0.7 } }).feeling).toMatchObject({ uneasy: { level: 0.5 }, mood: 0 });
    const off = setUp({ settings: NO_INSULA });
    const { feeling, trace } = off.tick({ readings: [reading("hungry", 1)], body: { health: 0 } });
    expect([feeling, trace]).toEqual([null, undefined]);
  });

  it("mood follows the surprises it is told of", () => {
    const surprises = [null, 0.9, null];
    const i = setUp({ surpriseOf: () => surprises.shift() ?? null });
    i.tick();
    expect(i.tick().feeling!.mood).toBeCloseTo(0.45, 1);
    expect(i.tick().feeling!.line).toBe("at ease, in good spirits");
  });

  it("takes far under a millisecond a tick", () => {
    const i = setUp();
    const readings = ["hungry", "hurting", "tired", "cold", "sick", "short of breath", "afraid", "tense"].map((word, n) => reading(word, n / 8));
    const started = performance.now();
    for (let n = 0; n < 2000; n++) i.tick({ readings, body: { health: 1 - (n % 7) / 100, food: 0.5, breath: 1 } }, 1);
    expect((performance.now() - started) / 2000).toBeLessThan(0.5);
  });
});

describe("the insula's settings", () => {
  it("say what the deciding layers are told, and a bad value is named", () => {
    expect(told({ feeling: 1, tell: 0 })).toEqual({ line: false, numbers: true });
    expect(told({ feeling: 1, tell: 0.5 })).toEqual({ line: true, numbers: true });
    expect(told({ feeling: 1, tell: 1 })).toEqual({ line: true, numbers: false });
    // With no feeling there is no line to tell, whatever `tell` says.
    expect(told({ feeling: 0, tell: 1 })).toEqual({ line: false, numbers: true });
    expect(insulaProblem(DEFAULT_INSULA)).toBeNull();
    expect(insulaProblem({ ...DEFAULT_INSULA, tell: 2 })).toBe("insula.tell must be a number from 0 to 1, got 2");
  });
});
