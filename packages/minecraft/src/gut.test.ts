import { describe, expect, it } from "vitest";
import { createGut } from "./gut.js";

/** Eats a food and falls ill a second later. */
function badMeal(gut: ReturnType<typeof createGut>, food: string, at: number, over: { fresh?: boolean; hostileNear?: boolean; effect?: string } = {}) {
  gut.ate(food, at);
  return gut.fellIll(over.effect ?? "poison", at + 1000, over.fresh ?? true, over.hostileNear ?? false);
}

describe("createGut", () => {
  it("knows what it was born knowing; with nothing innate, nothing is known bad at the start", () => {
    expect(createGut({ innate: ["rotten_flesh"] }).knowsBad("rotten_flesh")).toBe(true);
    const naive = createGut({ innate: [] });
    expect(["rotten_flesh", "spider_eye", "pufferfish", "bread"].map((f) => naive.knowsBad(f))).toEqual([false, false, false, false]);
  });

  it("one meal followed by illness is not enough; two separate ones make the food known bad", () => {
    const gut = createGut({ innate: [] });
    gut.ate("bread", 0); // it has eaten something else before, so there is something to compare with
    expect(badMeal(gut, "spider_eye", 10_000)).toEqual({ blamed: "spider_eye", learned: false, count: 1 });
    expect(gut.knowsBad("spider_eye")).toBe(false);
    expect(badMeal(gut, "spider_eye", 60_000)).toEqual({ blamed: "spider_eye", learned: true, count: 2 });
    expect(gut.knowsBad("spider_eye")).toBe(true);
    expect(gut.entries()).toEqual({ spider_eye: 2 });
    expect(gut.justLearned()).toEqual(["spider_eye"]);
    expect(gut.justLearned()).toEqual([]);
    expect(gut.knowsBad("bread")).toBe(false);
  });

  it("one meal counts once: incidents must be at least 30 seconds apart", () => {
    const gut = createGut({ innate: [] });
    gut.ate("bread", 0);
    badMeal(gut, "spider_eye", 10_000);
    badMeal(gut, "spider_eye", 20_000, { effect: "hunger" });
    expect(gut.knowsBad("spider_eye")).toBe(false);
    badMeal(gut, "spider_eye", 45_000);
    expect(gut.knowsBad("spider_eye")).toBe(true);
  });

  it("never blames the food for an illness a mob could have given it, or one it already had", () => {
    const gut = createGut({ innate: [] });
    gut.ate("bread", 0);
    for (const at of [10_000, 60_000, 120_000]) {
      expect(badMeal(gut, "cooked_beef", at, { hostileNear: true })).toMatchObject({ blamed: null, learned: false, note: expect.stringContaining("hostile") });
      expect(badMeal(gut, "cooked_beef", at + 200, { fresh: false })).toMatchObject({ blamed: null, learned: false });
    }
    expect(gut.knowsBad("cooked_beef")).toBe(false);
    expect(gut.entries()).toEqual({});
  });

  it("does not blame a meal that ended more than a few seconds before", () => {
    const gut = createGut({ innate: [] });
    gut.ate("bread", 0);
    expect(gut.fellIll("poison", 20_000, true, false)).toEqual({ blamed: null, learned: false });
    expect(createGut({ innate: [] }).fellIll("poison", 0, true, false)).toEqual({ blamed: null, learned: false });
  });

  it("the only food it has ever eaten needs a third incident, and says so", () => {
    const gut = createGut({ innate: [] });
    expect(badMeal(gut, "spider_eye", 0).learned).toBe(false);
    expect(badMeal(gut, "spider_eye", 60_000)).toMatchObject({ learned: false, note: expect.stringContaining("only food it has ever eaten") });
    expect(gut.knowsBad("spider_eye")).toBe(false);
    expect(badMeal(gut, "spider_eye", 120_000).learned).toBe(true);
  });

  it("starts from what was learned before, and learns nothing with learning off", () => {
    expect(createGut({ innate: [], learned: { spider_eye: 2, bread: 1 } }).knowsBad("spider_eye")).toBe(true);
    const off = createGut({ innate: [], learnBadFoods: 0 });
    off.ate("bread", 0);
    for (const at of [10_000, 60_000, 120_000]) badMeal(off, "spider_eye", at);
    expect(off.knowsBad("spider_eye")).toBe(false);
  });
});
