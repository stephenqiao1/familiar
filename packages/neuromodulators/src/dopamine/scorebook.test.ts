import { describe, expect, it } from "vitest";
import { chanceOfPayoff, createScorebook, featuresOf, kindFeature, labelFeature, skillFeature, thingFeature } from "./scorebook.js";

const DAY = "day/safe/fed";
const NIGHT = "night/safe/fed";
const chest = (id: string) => ({ kind: "chest", id });

describe("featuresOf", () => {
  it("is the skill in general, the skill under each label, the kind of thing and the thing itself", () => {
    expect(featuresOf("day/hungry", "eat")).toEqual(["eat", "eat | day", "eat | hungry"]);
    expect(featuresOf("day", "go_to", { kind: "cow" })).toEqual(["go_to", "go_to | day", "go_to → cow"]);
    expect(featuresOf("day", "go_to", chest("pos:1,2,3"))).toEqual(["go_to", "go_to | day", "go_to → chest", "go_to → chest # pos:1,2,3"]);
  });
});

describe("createScorebook", () => {
  it("starts with nothing expected, and benefit and cost at 1", () => {
    expect(createScorebook().get(NIGHT, "sleep")).toEqual({ expected: 0, benefit: 1, cost: 1, runs: 0, successes: 0 });
  });

  it("moves the expectation a step toward the outcome and returns the surprise", () => {
    const book = createScorebook();
    expect(book.learn(NIGHT, "sleep", 1, 0.1)).toBe(1);
    // Two levels (the skill, then its labels), each taking a tenth of what is left: 0.1 + 0.09.
    const entry = book.get(NIGHT, "sleep");
    expect(entry.expected).toBeCloseTo(0.19);
    expect(entry.benefit).toBeGreaterThan(1.15);
    expect(entry.cost).toBeLessThan(0.85);
    expect(book.get(NIGHT, "eat")).toMatchObject({ expected: 0, benefit: 1, cost: 1 });
  });

  it("lets a bad surprise raise the cost and lower the benefit", () => {
    const book = createScorebook();
    expect(book.learn(DAY, "go_to", -0.5, 0.1)).toBe(-0.5);
    const entry = book.get(DAY, "go_to");
    expect(entry.expected).toBeCloseTo(-0.095);
    expect(entry.benefit).toBeLessThan(1);
    expect(entry.cost).toBeGreaterThan(1);
  });

  it("is surprised less each time the same outcome repeats, each level taking its step of what is left", () => {
    const book = createScorebook();
    const surprises = Array.from({ length: 10 }, () => book.learn(DAY, "eat", 1, 0.1));
    expect(surprises[0]).toBe(1);
    expect(surprises[1]).toBeCloseTo(0.9 ** 2);
    expect(surprises[9]).toBeCloseTo(0.9 ** 18);
    // Aimed at a particular thing there are four levels.
    const aimed = createScorebook();
    aimed.learn(DAY, "go_to", 1, 0.1, chest("A"));
    expect(aimed.learn(DAY, "go_to", 1, 0.1, chest("A"))).toBeCloseTo(0.9 ** 4);
  });

  it("learns nothing at any level from a run that turned out as expected", () => {
    const book = createScorebook();
    for (let i = 0; i < 200; i++) book.learn(DAY, "eat", 0.4, 0.1, chest("A"));
    const before = book.entries();
    expect(book.learn(DAY, "eat", 0.4, 0.1, chest("A"))).toBeCloseTo(0);
    for (const [i, e] of book.entries().entries()) expect(e.expected).toBeCloseTo(before[i]!.expected);
  });

  it("never lets benefit or cost go below 0", () => {
    const book = createScorebook();
    book.learn("day", "attack", -100, 0.5);
    expect(book.get("day", "attack").benefit).toBe(0);
  });

  describe("what is learned in one situation is known in another", () => {
    it("carries most of a skill's value from day to night: only the day label's share stays behind", () => {
      const book = createScorebook();
      for (let i = 0; i < 20; i++) book.learn(DAY, "take_items", 0.5, 0.1);
      const [day, night] = [book.get(DAY, "take_items").expected, book.get(NIGHT, "take_items").expected];
      expect(day).toBeGreaterThan(0.4);
      expect(night).toBeGreaterThan(0.75 * day); // the skill, "safe" and "fed" carry over; only the share of "day" does not
      expect(night).toBeLessThan(day);
      expect(book.get(NIGHT, "sleep").expected).toBe(0); // another skill learned nothing
    });

    it("then learns the difference night makes, and keeps the day's value", () => {
      const book = createScorebook();
      for (let i = 0; i < 30; i++) book.learn(DAY, "go_to", 0.5, 0.1);
      for (let i = 0; i < 300; i++) {
        book.learn(NIGHT, "go_to", -0.5, 0.1);
        book.learn(DAY, "go_to", 0.5, 0.1);
      }
      expect(book.get(DAY, "go_to").expected).toBeGreaterThan(0.3);
      expect(book.get(NIGHT, "go_to").expected).toBeLessThan(-0.3);
    });
  });

  describe("what a skill is aimed at", () => {
    it("starts a thing never visited from what its kind is worth", () => {
      const book = createScorebook();
      for (let i = 0; i < 10; i++) book.learn(DAY, "take_items", 0.5, 0.1, chest("A"));
      expect(book.aimed("take_items", chest("B")).expected).toBeGreaterThan(0);
      expect(book.aimed("take_items", chest("B")).expected).toBeLessThan(book.aimed("take_items", chest("A")).expected);
      expect(book.aimed("take_items", { kind: "barrel" })).toEqual({ expected: 0, benefit: 1, cost: 1 });
    });

    it("tells a full chest from an empty one", () => {
      const book = createScorebook();
      for (let i = 0; i < 40; i++) {
        book.learn(DAY, "take_items", 0.5, 0.1, chest("full"));
        book.learn(DAY, "take_items", -0.05, 0.1, chest("empty"));
      }
      expect(book.aimed("take_items", chest("full")).expected).toBeGreaterThan(0);
      expect(book.aimed("take_items", chest("empty")).expected).toBeLessThan(0);
      expect(book.get(DAY, "take_items", chest("full")).expected).toBeGreaterThan(book.get(DAY, "take_items", chest("empty")).expected + 0.3);
    });

    it("keeps a kind without an id (a cow) to its kind alone", () => {
      const book = createScorebook();
      book.learn(DAY, "go_to", 1, 0.1, { kind: "cow" });
      expect(book.entries().map((e) => e.feature)).toEqual(["go_to", "go_to | day", "go_to | safe", "go_to | fed", "go_to → cow"]);
    });
  });

  it("saves and restores its adjustments", () => {
    const book = createScorebook();
    book.learn("night", "sleep", 1, 0.1, chest("A"));
    book.record("night", "sleep", true);
    const restored = createScorebook(book.entries());
    expect(restored.get("night", "sleep", chest("A"))).toEqual(book.get("night", "sleep", chest("A")));
    expect(restored.entries().map((e) => e.feature)).toEqual([skillFeature("sleep"), labelFeature("sleep", "night"), kindFeature("sleep", "chest"), thingFeature("sleep", chest("A"))]);
  });

  it("counts a skill's runs and successes wherever they happened, giving the chance of payoff", () => {
    const book = createScorebook();
    expect(chanceOfPayoff(book.get("day", "eat"))).toBe(0.5);
    for (let i = 0; i < 3; i++) book.record("day", "eat", true);
    book.record("night", "eat", false);
    expect(book.get("day", "eat")).toMatchObject({ runs: 4, successes: 3, expected: 0 });
    expect(chanceOfPayoff(book.get("night", "eat"))).toBeCloseTo(4 / 6);
    expect(chanceOfPayoff(book.get("day", "sleep"))).toBe(0.5);
  });

  it("loads adjustments saved without counts as having none", () => {
    const old = createScorebook([{ feature: "eat", expected: 0.2, benefit: 1.1, cost: 0.9 }]);
    expect(old.get("day", "eat")).toEqual({ expected: 0.2, benefit: 1.1, cost: 0.9, runs: 0, successes: 0 });
  });

  it("counts runs cut short in a row for the most particular thing known, until one finishes", () => {
    const scorebook = createScorebook();
    const chest = { kind: "chest", id: "pos:1,0,0" };
    expect([scorebook.cutShort("go_to", chest), scorebook.cutShort("go_to", chest), scorebook.cutShort("go_to", chest)]).toEqual([0, 1, 2]);
    // Another chest, and the skill with no aim, are counted by themselves.
    expect(scorebook.cutShort("go_to", { kind: "chest", id: "pos:9,0,0" })).toBe(0);
    expect(scorebook.cutShort("go_to")).toBe(0);
    // A failed run did not finish either: the count goes on. One that succeeded starts it again.
    scorebook.record("day", "go_to", false, chest);
    expect(scorebook.cutShort("go_to", chest)).toBe(3);
    scorebook.record("day", "go_to", true, chest);
    expect(scorebook.cutShort("go_to", chest)).toBe(0);
    // The count is saved with the rest.
    expect(createScorebook(scorebook.entries()).cutShort("go_to", chest)).toBe(1);
  });

  it("lists each particular thing it has learned about once, and still does after saving", () => {
    const scorebook = createScorebook();
    expect(scorebook.things()).toEqual([]);
    scorebook.learn("day", "go_to", 1, 0.1, { kind: "chest", id: "pos:1,0,0" });
    scorebook.learn("night", "take_items ⇒ food_stock", 0.5, 0.1, { kind: "chest", id: "pos:1,0,0" });
    scorebook.learn("day", "go_to", 1, 0.1, { kind: "barrel", id: "pos:9,0,0" });
    scorebook.learn("day", "go_to", 1, 0.1, { kind: "cow" }); // known only by its kind
    const things = [{ kind: "chest", id: "pos:1,0,0" }, { kind: "barrel", id: "pos:9,0,0" }];
    expect(scorebook.things()).toEqual(things);
    expect(createScorebook(scorebook.entries()).things()).toEqual(things);
  });
});
