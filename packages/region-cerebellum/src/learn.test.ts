import { describe, expect, it } from "vitest";
import { bounded, learnChanges, learnMeasure, shareOf, sureOf } from "./learn.js";
import { createModels, modelId, type Estimate } from "./model.js";
import { expectedChanges, predict } from "./predict.js";
import { DEFAULT_CEREBELLUM as S } from "./settings.js";

const DAY = 20 * 60_000;
/** Feeds the same result `times` times, one second apart. */
function feed(actual: number, times: number, from?: Estimate, at = 0): Estimate {
  let e = from;
  for (let i = 0; i < times; i++) e = learnMeasure(e, actual, at + i * 1000, S).estimate;
  return e!;
}

describe("learning a measure by its error", () => {
  it("moves the prediction toward the result by the signed error", () => {
    const settled = feed(10, 20);
    const slower = learnMeasure(settled, 14, 20_000, S);
    expect(slower.error).toBeCloseTo(4);
    expect(slower.estimate.value).toBeCloseTo(10.4);
    const quicker = learnMeasure(settled, 6, 20_000, S);
    expect(quicker.error).toBeCloseTo(-4);
    expect(quicker.estimate.value).toBeCloseTo(9.6);
  });

  it("moves the spread toward the size of the error, whichever way the error went", () => {
    const settled = feed(10, 20);
    expect(settled.spread).toBeCloseTo(0);
    const off = learnMeasure(settled, 6, 20_000, S).estimate;
    expect(off.spread).toBeCloseTo(0.4);
    // Results that keep landing 2 away settle the spread at 2.
    let e = feed(10, 20);
    for (let i = 0; i < 200; i++) e = learnMeasure(e, i % 2 ? 12 : 8, 30_000 + i, S).estimate;
    expect(e.spread).toBeGreaterThan(1.7);
    expect(e.spread).toBeLessThan(2.3);
  });

  it("learns fast while new, then settles at a tenth of each error", () => {
    const first = learnMeasure(undefined, 10, 0, S);
    expect(first.rate).toBe(1);
    const second = learnMeasure(first.estimate, 20, 1000, S);
    expect(second.rate).toBeCloseTo(0.5, 2);
    expect(second.estimate.value).toBeCloseTo(15, 1);
    expect(learnMeasure(feed(10, 30), 20, 31_000, S).rate).toBeCloseTo(0.1);
  });

  it("an unused model becomes less sure, and is relearned quickly", () => {
    const settled = feed(10, 30);
    expect(sureOf(settled, 30_000, S)).toBe(30);
    const later = 30_000 + 10 * DAY;
    expect(sureOf(settled, later, S)).toBeLessThan(S.trusted);
    // A new tool: the first result after the long gap moves it much further than a tenth.
    expect(learnMeasure(settled, 2, later, S).rate).toBeGreaterThan(0.2);
  });

  it("keeps every learned number inside its bounds", () => {
    expect(bounded(900, [0, 600])).toBe(600);
    const e = learnMeasure(undefined, 5000, 0, S, [0, 600]).estimate;
    expect(e.value).toBe(600);
  });

  it("gives the same models for the same runs", () => {
    const runs = [3, 9, 4, 4, 7, 5];
    const once = runs.reduce<Estimate | undefined>((e, v, i) => learnMeasure(e, v, i * 500, S).estimate, undefined);
    const again = runs.reduce<Estimate | undefined>((e, v, i) => learnMeasure(e, v, i * 500, S).estimate, undefined);
    expect(once).toEqual(again);
  });
});

describe("learning what a movement changes", () => {
  it("a change that follows nine times in ten is a learned expectation; one that follows half the time is not", () => {
    let model: { runs: number; changes: Record<string, number>; at: number } | undefined;
    for (let i = 0; i < 10; i++) model = { ...learnChanges(model, i === 3 ? ["turned"] : i % 2 ? ["turned", "lost"] : ["turned", "lost", "drops"], i, S), at: i };
    expect(shareOf(model!, "turned")).toBe(1);
    expect(shareOf(model!, "lost")).toBeCloseTo(0.9);
    expect(shareOf(model!, "drops")).toBeCloseTo(0.5);
    const store = createModels({ [modelId("primitive", "use_item", "")]: { measures: {}, ...model!, at: 9 } });
    expect(expectedChanges(store, "primitive", "use_item", [""], 10, S)?.changes).toEqual(["lost", "turned"]);
  });

  it("stops expecting a change that has stopped following", () => {
    let model: { runs: number; changes: Record<string, number>; at: number } | undefined;
    for (let i = 0; i < 20; i++) model = { ...learnChanges(model, ["opened"], i, S), at: i };
    for (let i = 20; i < 26; i++) model = { ...learnChanges(model, [], i, S), at: i };
    expect(shareOf(model!, "opened")).toBeLessThan(S.expectedAt);
  });
});

describe("trust and falling back", () => {
  const at = 10_000;
  const model = (value: number, seen: number) => ({ measures: { seconds: { value, spread: 0.2, seen, at } }, runs: seen, changes: {}, at });

  it("a specific key with too few runs uses the general one", () => {
    const store = createModels({ [modelId("primitive", "break_block", "stone|wooden_pickaxe")]: model(1.2, 3), [modelId("primitive", "break_block", "stone")]: model(4, 8) });
    const p = predict(store, "primitive", "break_block", ["stone|wooden_pickaxe", "stone", ""], "seconds", at, S);
    expect(p).toMatchObject({ value: 4, key: "stone" });
  });

  it("uses the specific key once it is trusted", () => {
    const store = createModels({ [modelId("primitive", "break_block", "stone|wooden_pickaxe")]: model(1.2, 5), [modelId("primitive", "break_block", "stone")]: model(4, 8) });
    expect(predict(store, "primitive", "break_block", ["stone|wooden_pickaxe", "stone", ""], "seconds", at, S)?.value).toBe(1.2);
  });

  it("with no trusted model at all says nothing, so the fixed number is used", () => {
    const store = createModels({ [modelId("primitive", "break_block", "stone")]: model(4, 4) });
    expect(predict(store, "primitive", "break_block", ["stone|wooden_pickaxe", "stone", ""], "seconds", at, S)).toBeNull();
    expect(expectedChanges(store, "primitive", "break_block", ["stone", ""], at, S)).toBeNull();
  });
});
