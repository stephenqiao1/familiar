import { describe, expect, it } from "vitest";
import { learnedExpectations } from "./expect.js";
import { learnChanges, learnMeasure } from "./learn.js";
import { createModels, modelId, type ModelStore } from "./model.js";
import { giveUpBase } from "./readers.js";
import { DEFAULT_CEREBELLUM as S, NO_READERS } from "./settings.js";
import { createTiming } from "./timing.js";

/** Teaches one model by plain numbers: each run's seconds and the changes that followed. */
function teach(store: ModelStore, id: string, runs: { seconds?: number; changes?: string[] }[], from = 0) {
  runs.forEach((run, i) => {
    const before = store.get(id);
    const at = from + i * 1000;
    const measures = { ...before?.measures, ...(run.seconds === undefined ? {} : { seconds: learnMeasure(before?.measures.seconds, run.seconds, at, S).estimate }) };
    store.set(id, { measures, ...learnChanges(before, run.changes ?? [], at, S), at });
  });
}
const MIN = 60_000;
const FIXED = 2 * MIN;

describe("the give-up clock's base", () => {
  it("is the fixed two minutes until the skill's time is trusted", () => {
    const store = createModels();
    teach(store, modelId("skill", "mine", ""), [{ seconds: 200 }, { seconds: 200 }]);
    expect(giveUpBase(store, "mine", FIXED, 5000, S)).toEqual({ ms: FIXED });
  });

  it("follows the skill's usual time and three spreads", () => {
    const store = createModels();
    teach(store, modelId("skill", "mine", ""), [150, 250, 150, 250, 150, 250, 200, 200].map((seconds) => ({ seconds })));
    const base = giveUpBase(store, "mine", FIXED, 9000, S);
    expect(base.ms).toBeCloseTo((base.learned!.seconds + 3 * base.learned!.spread) * 1000, 3);
    expect(base.ms).toBeGreaterThan(FIXED);
    expect(base.ms).toBeLessThanOrEqual(3 * FIXED);
  });

  it("is kept between a quarter and three times the fixed base", () => {
    const store = createModels();
    teach(store, modelId("skill", "look_at", ""), Array.from({ length: 6 }, () => ({ seconds: 0.3 })));
    teach(store, modelId("skill", "voyage", ""), Array.from({ length: 6 }, () => ({ seconds: 550 })));
    expect(giveUpBase(store, "look_at", FIXED, 9000, S).ms).toBe(FIXED / 4);
    expect(giveUpBase(store, "voyage", FIXED, 9000, S).ms).toBe(3 * FIXED);
  });

  it("goes part of the way at part strength, and nowhere at 0", () => {
    const store = createModels();
    teach(store, modelId("skill", "look_at", ""), Array.from({ length: 6 }, () => ({ seconds: 0.3 })));
    expect(giveUpBase(store, "look_at", FIXED, 9000, { ...S, giveUp: 0.5 }).ms).toBe((FIXED + FIXED / 4) / 2);
    expect(giveUpBase(store, "look_at", FIXED, 9000, { ...S, ...NO_READERS })).toEqual({ ms: FIXED });
  });
});

describe("learned expectations", () => {
  const always = (changes: string[], n = 6) => Array.from({ length: n }, () => ({ changes }));
  const ask = (store: ModelStore, name: string, keys: string[], written: string[], settings = S) => learnedExpectations(store, "primitive", name, keys, written, 10_000, settings);

  it("fill an empty written list once a model is trusted", () => {
    const store = createModels();
    teach(store, modelId("primitive", "jump", ""), always(["moved"], 3));
    expect(ask(store, "jump", ["stone", ""], [])).toBeNull();
    teach(store, modelId("primitive", "jump", ""), always(["moved"], 3), 3000);
    expect(ask(store, "jump", ["stone", ""], [])).toMatchObject({ expects: ["moved"], key: "" });
  });

  it("leave a written list alone where experience agrees, and where only the general model disagrees", () => {
    const store = createModels();
    teach(store, modelId("primitive", "hit", "cow|bare"), always(["targetHurt", "turned"]));
    teach(store, modelId("primitive", "hit", ""), always([]));
    expect(ask(store, "hit", ["cow|bare", "cow", ""], ["targetHurt"])).toBeNull();
    expect(ask(store, "hit", ["zombie|bare", "zombie", ""], ["targetHurt"])).toBeNull();
  });

  it("replace a written one only in the situation where it mostly fails to follow, and say why", () => {
    const store = createModels();
    teach(store, modelId("primitive", "break_block", "obsidian|bare"), always(["turned"]));
    teach(store, modelId("primitive", "break_block", "stone|bare"), always(["targetBlock=air", "drops+"]));
    const learned = ask(store, "break_block", ["obsidian|bare", "obsidian", ""], ["targetBlock=air"]);
    expect(learned).toMatchObject({ expects: ["turned"], key: "obsidian|bare" });
    expect(learned!.why).toContain("targetBlock=air follows only 0%");
    expect(ask(store, "break_block", ["stone|bare", "stone", ""], ["targetBlock=air"])).toBeNull();
    // "drops" is met by "drops+".
    expect(ask(store, "drop_item", ["stone|bare", ""], ["drops"])).toBeNull();
  });

  it("are never used at strength 0", () => {
    const store = createModels();
    teach(store, modelId("primitive", "jump", ""), always(["moved"]));
    expect(ask(store, "jump", [""], [], { ...S, ...NO_READERS })).toBeNull();
  });
});

describe("timing", () => {
  const PAIR = ["seen|creeper", "hurt|creeper"] as const;
  function setup(settings = S) {
    const store = createModels();
    const timing = createTiming({ store, settings, pairs: () => [PAIR] });
    /** One meeting: the sign, then what follows `delay` seconds later. Learned like any movement. */
    const meet = (at: number, delay: number) => {
      timing.event(PAIR[0], at);
      for (const m of timing.event(PAIR[1], at + delay * 1000)) teach(store, modelId(m.kind, m.name, ""), [{ seconds: m.measures.seconds! }], m.at);
    };
    return { store, timing, meet };
  }

  it("learns the delay of a pair and its spread", () => {
    const { store, meet } = setup();
    [4, 6, 4, 6, 5, 5].forEach((delay, i) => meet(i * 30_000, delay));
    const learned = store.get(modelId("timing", "seen|creeper>hurt|creeper", ""))!.measures.seconds!;
    expect(learned.value).toBeGreaterThan(4);
    expect(learned.value).toBeLessThan(6);
    expect(learned.spread).toBeGreaterThan(0.3);
  });

  it("says what is due from a little before its earliest usual time to its latest, and not before or after", () => {
    const { timing, meet } = setup();
    for (let i = 0; i < 6; i++) meet(i * 30_000, 20);
    const at = 300_000;
    timing.event(PAIR[0], at);
    // Usual at 20 s, one spread 2 s: due from 12 s (20 − 6 − 2) to 26 s.
    expect(timing.due(at + 5000)).toEqual([]);
    expect(timing.due(at + 13_000)).toMatchObject([{ sign: PAIR[0], what: PAIR[1], inSeconds: 7 }]);
    expect(timing.due(at + 25_000)).toHaveLength(1);
    expect(timing.due(at + 27_000)).toEqual([]);
  });

  it("says nothing with too few meetings, once the event has come, or at strength 0", () => {
    const few = setup();
    for (let i = 0; i < 3; i++) few.meet(i * 30_000, 20);
    few.timing.event(PAIR[0], 300_000);
    expect(few.timing.due(318_000)).toEqual([]);

    const came = setup();
    for (let i = 0; i < 6; i++) came.meet(i * 30_000, 20);
    came.meet(300_000, 15);
    expect(came.timing.due(318_000)).toEqual([]);

    const off = setup({ ...S, ...NO_READERS });
    for (let i = 0; i < 6; i++) off.meet(i * 30_000, 20);
    off.timing.event(PAIR[0], 300_000);
    expect(off.timing.due(318_000)).toEqual([]);
  });
});
