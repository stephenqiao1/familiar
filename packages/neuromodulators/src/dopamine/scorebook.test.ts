import { describe, expect, it } from "vitest";
import { chanceOfPayoff, createScorebook } from "./scorebook.js";

describe("createScorebook", () => {
  it("starts with nothing expected, and benefit and cost at 1", () => {
    expect(createScorebook().get("night", "sleep")).toEqual({ expected: 0, benefit: 1, cost: 1, runs: 0, successes: 0 });
  });

  it("moves the expectation a step toward the outcome and returns the surprise", () => {
    const book = createScorebook();
    expect(book.learn("night", "sleep", 1, 0.1)).toBe(1);
    expect(book.get("night", "sleep")).toMatchObject({ expected: 0.1, benefit: 1.1, cost: 0.9 });
    expect(book.get("day", "sleep")).toMatchObject({ expected: 0, benefit: 1, cost: 1 });
  });

  it("lets a bad surprise raise the cost and lower the benefit", () => {
    const book = createScorebook();
    expect(book.learn("day", "go_to", -0.5, 0.1)).toBe(-0.5);
    expect(book.get("day", "go_to")).toMatchObject({ expected: -0.05, benefit: 0.95, cost: 1.05 });
  });

  it("is surprised less each time the same outcome repeats", () => {
    const book = createScorebook();
    const surprises = Array.from({ length: 10 }, () => book.learn("day", "eat", 1, 0.1));
    expect(surprises[0]).toBe(1);
    expect(surprises[1]).toBeCloseTo(0.9);
    expect(surprises[9]).toBeCloseTo(0.9 ** 9);
    for (let i = 1; i < 10; i++) expect(surprises[i]).toBeLessThan(surprises[i - 1]!);
  });

  it("never lets benefit or cost go below 0", () => {
    const book = createScorebook();
    book.learn("day", "attack", -20, 0.1);
    expect(book.get("day", "attack").benefit).toBe(0);
  });

  it("saves and restores its entries", () => {
    const book = createScorebook();
    book.learn("night", "sleep", 1, 0.1);
    const restored = createScorebook(book.entries());
    expect(restored.get("night", "sleep")).toEqual(book.get("night", "sleep"));
    expect(restored.entries()).toEqual([{ situation: "night", skill: "sleep", expected: 0.1, benefit: 1.1, cost: 0.9, runs: 0, successes: 0 }]);
  });

  it("counts runs and successes, giving the chance of payoff", () => {
    const book = createScorebook();
    expect(chanceOfPayoff(book.get("day", "eat"))).toBe(0.5);
    for (let i = 0; i < 3; i++) book.record("day", "eat", true);
    book.record("day", "eat", false);
    expect(book.get("day", "eat")).toMatchObject({ runs: 4, successes: 3, expected: 0 });
    expect(chanceOfPayoff(book.get("day", "eat"))).toBeCloseTo(4 / 6);
    expect(chanceOfPayoff(book.get("night", "eat"))).toBe(0.5);
  });

  it("loads entries saved before runs were counted as having none", () => {
    const old = createScorebook([{ situation: "day", skill: "eat", expected: 0.2, benefit: 1.1, cost: 0.9 }]);
    expect(old.get("day", "eat")).toEqual({ expected: 0.2, benefit: 1.1, cost: 0.9, runs: 0, successes: 0 });
  });
});
