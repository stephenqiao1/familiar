import type { State } from "@familiar/contracts";
import { describe, expect, it } from "vitest";
import { createNoveltyMemory, createNoveltyRule } from "./novelty.js";

/** A state whose data lists what is in view. */
const view = (...kinds: string[]): State => ({ schemaVersion: 1, tick: 0, timestamp: 0, data: { kinds } });
const noticed = (s: State) => s.data.kinds as string[];

function setup(saved?: Record<string, number>) {
  const memory = createNoveltyMemory(saved);
  const rule = createNoveltyRule({ noticed, memory });
  const see = (...kinds: string[]) => rule.check({ before: view(), after: view(...kinds), events: [] });
  return { memory, see };
}

describe("createNoveltyRule", () => {
  it("rewards a first meeting, then half as much each time it comes back into view", () => {
    const { see } = setup();
    expect(see("cow")).toEqual({ amount: 0.5, reason: "new cow" });
    expect(see()).toBeNull();
    expect(see("cow")).toEqual({ amount: 0.25, reason: "cow (seen 1×)" });
    see();
    expect(see("cow")?.amount).toBe(0.125);
  });

  it("counts a thing that stays in view once", () => {
    const { see } = setup();
    see("cow");
    expect(see("cow")).toBeNull();
    expect(see("cow", "chest")).toEqual({ amount: 0.5, reason: "new chest" });
  });

  it("pays at most one full bonus for several arrivals at once, but counts them all", () => {
    const { memory, see } = setup();
    expect(see("cow", "biome:plains", "pig")).toEqual({ amount: 0.5, reason: "new cow, new biome:plains, new pig" });
    expect(memory.entries()).toEqual({ cow: 1, "biome:plains": 1, pig: 1 });
  });

  it("remembers meetings from a saved memory", () => {
    const { memory, see } = setup({ cow: 2 });
    expect(see("cow")?.amount).toBe(0.125);
    expect(memory.entries()).toEqual({ cow: 3 });
  });
});
