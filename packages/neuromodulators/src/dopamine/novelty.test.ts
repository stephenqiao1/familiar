import type { State } from "@familiar/contracts";
import { describe, expect, it } from "vitest";
import { createNoveltyMemory, createNoveltyRule } from "./novelty.js";
import type { Reward } from "./rewards.js";

/** A state at time `at` (seconds) whose data lists what is in view. */
const view = (at: number, kinds: string[]): State => ({ schemaVersion: 1, tick: 0, timestamp: at * 1000, data: { kinds } });
const noticed = (s: State) => s.data.kinds as string[];
const MINUTE = 60;

function setup(options: { saved?: Record<string, number>; fresh?: () => boolean } = {}) {
  const memory = createNoveltyMemory(options.saved);
  const rule = createNoveltyRule({ noticed, memory, ...(options.fresh ? { fresh: options.fresh } : {}) });
  /** What is in view at a time; returns the reward. */
  const see = (at: number, ...kinds: string[]) => rule.check({ before: view(at, []), after: view(at, kinds), events: [] }) as Reward | null;
  return { memory, see };
}

describe("createNoveltyRule", () => {
  it("pays for a first meeting with what it relieves of the boredom so far, and less each time it comes back", () => {
    const { see } = setup();
    // Starts half bored: a brand-new kind takes half of that away.
    expect(see(0, "cow")).toEqual({ amount: expect.closeTo(0.5 ** 2 - 0.25 ** 2), reason: "new cow" });
    expect(see(1)).toBeNull();
    const again = see(2, "cow");
    expect(again).toMatchObject({ reason: "cow (seen 1×)" });
    expect(again!.amount).toBeGreaterThan(0);
    expect(again!.amount).toBeLessThan(0.5 ** 2 - 0.25 ** 2);
  });

  it("counts a thing that stays in view once", () => {
    const { see } = setup();
    see(0, "cow");
    expect(see(1, "cow")).toBeNull();
    expect(see(2, "cow", "chest")).toMatchObject({ reason: "new chest" });
  });

  it("charges for boredom building while nothing new appears, in a few steps", () => {
    const { see } = setup();
    see(0);
    const charges = [];
    for (let at = 1; at <= 5 * MINUTE; at++) {
      const reward = see(at);
      if (reward) charges.push(reward);
    }
    expect(charges.length).toBe(10); // half way to fully bored in five minutes, a twentieth at a time
    for (const c of charges) expect(c).toMatchObject({ reason: "nothing new for a while" });
    for (const c of charges) expect(c.amount).toBeLessThan(0);
    expect(charges.reduce((sum, c) => sum + c.amount, 0)).toBeCloseTo(0.5 ** 2 - 1);
  });

  it("can never pay more than the boredom that built up: a crowd of new things is worth one dull spell", () => {
    const { see } = setup();
    see(0);
    let charged = 0;
    for (let at = 1; at <= 5 * MINUTE; at++) charged += see(at)?.amount ?? 0;
    const crowd = see(5 * MINUTE + 1, "cow", "pig", "sheep", "horse", "chest", "bell");
    expect(crowd!.amount).toBeCloseTo(1); // fully bored, fully relieved
    expect(crowd!.amount + charged).toBeCloseTo(0.25); // all it ever had was the half it started with
    expect(see(5 * MINUTE + 2, "llama")).toBeNull(); // nothing left to relieve
  });

  it("relieves less for a kind met before, even on a new run", () => {
    const fresh = setup().see(0, "cow")!.amount;
    const known = setup({ saved: { cow: 3 } }).see(0, "cow")!.amount;
    expect(known).toBeGreaterThan(0);
    expect(known).toBeLessThan(fresh / 2);
  });

  it("remembers how often each kind was met", () => {
    const { memory, see } = setup({ saved: { cow: 2 } });
    see(0, "cow", "pig");
    see(1);
    see(2, "pig");
    expect(memory.entries()).toEqual({ cow: 3, pig: 2 });
  });

  it("at the start of a new life notes what is in view but pays and charges nothing", () => {
    let fresh = false;
    const { memory, see } = setup({ fresh: () => fresh });
    see(0, "cow");
    fresh = true;
    expect(see(20 * MINUTE, "desert", "camel")).toBeNull();
    fresh = false;
    expect(see(20 * MINUTE + 1, "desert", "camel")).toBeNull(); // already in view
    expect(memory.entries()).toMatchObject({ desert: 1, camel: 1 });
  });
});
