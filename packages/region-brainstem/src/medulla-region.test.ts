import type { State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import type { ReflexRule } from "@familiar/region-reflex";
import { describe, expect, it } from "vitest";
import { createMedullaRegion, overall, type MedullaOptions, type Vitals } from "./medulla-region.js";

const signal = new AbortController().signal;
const well: Vitals = { health: 1, air: 0, hunger: 0, sick: 0, cold: 0, tired: 0, reserve: 0.25 };
const body = (state: State) => ({ ...well, ...(state.data as Partial<Vitals>) });

function medulla(over: Partial<MedullaOptions> = {}) {
  const store = createWorkspace();
  const region = createMedullaRegion({ vitals: body, share: 1, ...over });
  let ms = 0;
  const tick = async (reading: Partial<Vitals> = {}, afterMs = 500) => {
    ms += afterMs;
    store.update({ schemaVersion: 1, tick: 0, timestamp: ms, data: { ...reading } }, null);
    return region.run(store.viewFor("medulla"), signal);
  };
  const value = (name: string) => store.signals()[name]?.value;
  return { store, tick, value };
}

describe("overall", () => {
  it("is 1 when everything is fine", () => {
    expect(overall([0, 0, 0, 0])).toBe(1);
    expect(overall([])).toBe(1);
  });

  it("follows the single worst reading, not the average", () => {
    const oneBad = overall([0.9, 0, 0, 0, 0]);
    const allMiddling = overall([0.3, 0.3, 0.3, 0.3, 0.3]);
    expect(oneBad).toBeLessThan(0.3);
    expect(allMiddling).toBeGreaterThan(0.65);
    // The worst reading decides most of it, whatever the rest are.
    expect(Math.abs(overall([0.9, 0, 0]) - overall([0.9, 0.2, 0.2]))).toBeLessThan(0.05);
    expect(overall([1, 1, 1])).toBe(0);
  });
});

describe("createMedullaRegion", () => {
  it("runs every tick on the fastest layer", () => {
    expect(createMedullaRegion({ vitals: body, share: 1 })).toMatchObject({ name: "medulla", layer: 0, everyMs: 0 });
  });

  it("shares every vital sign, with the names the rest of the brain already uses", async () => {
    const { tick, value, store } = medulla();
    const out = await tick({ health: 0.6, air: 0.4, hunger: 0.7, sick: 0.5, cold: 0.2, tired: 0.3, reserve: 0.1 });
    expect([value("air"), value("hunger"), value("hurt"), value("sick"), value("cold"), value("tired"), value("reserve")]).toEqual([0.4, 0.7, 0.4, 0.5, 0.2, 0.3, 0.1]);
    expect(value("pain")).toBe(0);
    expect(Object.keys(store.signals()).sort()).toEqual(["air", "cold", "hunger", "hurt", "pain", "reserve", "sick", "tired", "vitals"]);
    expect(out.trace?.vitals).toMatchObject({ hurt: 0.4, sick: 0.5 });
    expect(out.proposals).toEqual([]);
  });

  it("vitals is 1 when all is well and follows the worst reading", async () => {
    const { tick, value } = medulla();
    await tick();
    expect(value("vitals")).toBe(1);
    await tick({ hunger: 0.9 });
    const hungry = value("vitals")!;
    expect(hungry).toBeLessThan(0.3);
    await tick({ hunger: 0.9, tired: 0.3, sick: 0.2 });
    expect(Math.abs(value("vitals")! - hungry)).toBeLessThan(0.1);
  });

  it("pain is the recent sting: it jumps on a hurt and fades over about 10 seconds; hurt is the standing level", async () => {
    const { tick, value } = medulla();
    await tick();
    await tick({ health: 0.8 });
    expect(value("pain")).toBeCloseTo(0.6);
    expect(value("hurt")).toBeCloseTo(0.2);
    await tick({ health: 0.8 }, 10_000);
    expect(value("pain")).toBeLessThan(0.05);
    expect(value("hurt")).toBeCloseTo(0.2);
  });

  it("leaves out cold when the body cannot feel it", async () => {
    const { tick, value } = medulla({ vitals: () => ({ health: 1, air: 0, hunger: 0, sick: 0, tired: 0, reserve: 1 }) });
    await tick();
    expect(value("cold")).toBeUndefined();
    expect(value("vitals")).toBe(1);
  });

  it("after a death every vital sign starts from the fresh body's values", async () => {
    const { tick, value } = medulla();
    await tick({ deaths: 0 });
    await tick({ deaths: 0, health: 0.1, hunger: 0.9, sick: 1 });
    expect(value("pain")).toBe(1);
    expect(value("vitals")).toBeLessThan(0.2);
    // It dies and respawns whole: the old pain does not carry over, and health going back up is not a hurt.
    await tick({ deaths: 1 });
    expect([value("pain"), value("hurt"), value("sick"), value("hunger"), value("vitals")]).toEqual([0, 0, 0, 0, 1]);
  });

  it("shares nothing with sharing off, but still traces the readings", async () => {
    const { tick, store } = medulla({ share: 0 });
    const out = await tick({ hunger: 0.5 });
    expect(store.signals()).toEqual({});
    expect(out.trace?.vitals).toMatchObject({ hunger: 0.5 });
  });

  describe("urges", () => {
    const breathe: ReflexRule = { name: "need_air", kind: "soft", check: (ws) => ((ws.state.data as Partial<Vitals>).air ?? 0) > 0.4 ? { action: { skill: "surface" }, urgency: 0.6, reason: "short of breath" } : null };

    it("proposes what an urge asks for, scaled by its gain and capped below 1, and says why", async () => {
      const { tick } = medulla({ urges: [breathe], gainOf: () => 1.4 });
      expect((await tick()).proposals).toEqual([]);
      const out = await tick({ air: 0.5 });
      expect(out.proposals).toEqual([{ action: { skill: "surface" }, urgency: expect.closeTo(0.84), reason: "short of breath" }]);
      expect(out.trace?.urges).toEqual([{ rule: "need_air", kind: "soft", skill: "surface", base: 0.6, gain: 1.4, urgency: expect.closeTo(0.84), why: "short of breath" }]);
      const loud = medulla({ urges: [breathe], gainOf: () => 9 });
      expect((await loud.tick({ air: 0.5 })).proposals[0]?.urgency).toBe(0.95);
    });

    it("shares the strongest urge as `urge`, and 0 when none fires", async () => {
      const { tick, value } = medulla({ urges: [breathe] });
      await tick();
      expect(value("urge")).toBe(0);
      await tick({ air: 0.5 });
      expect(value("urge")).toBeCloseTo(0.6);
      await tick();
      expect(value("urge")).toBe(0);
    });

    it("keeps running while the body sleeps, and notes an urge that fires then", async () => {
      const { tick } = medulla({ urges: [breathe], asleep: () => true });
      expect((await tick()).trace?.urgeWhileAsleep).toBeUndefined();
      expect((await tick({ air: 0.5 })).trace?.urgeWhileAsleep).toEqual(["need_air"]);
    });
  });

  describe("analgesia", () => {
    it("scales only the shared pain: the reading, the urges and the other signs see the damage as it is", async () => {
      let analgesia = 0.7;
      const starving: ReflexRule = { name: "hurting", kind: "soft", check: (ws) => ((ws.state.data as Partial<Vitals>).health ?? 1) < 0.9 ? { action: { skill: "eat" }, urgency: 0.8, reason: "hurt" } : null };
      const { tick, value } = medulla({ analgesiaOf: () => analgesia, urges: [starving] });
      await tick();
      const out = await tick({ health: 0.7 });
      expect((out.trace?.vitals as { pain: number }).pain).toBeCloseTo(0.9);
      expect(value("pain")).toBeCloseTo(0.9 * 0.3);
      expect(out.trace?.painDulled).toMatchObject({ analgesia: 0.7 });
      expect(value("hurt")).toBeCloseTo(0.3);
      expect(out.proposals).toMatchObject([{ action: { skill: "eat" }, urgency: 0.8 }]);
      // Once the analgesia has gone, what is left of the pain is felt in full.
      analgesia = 0;
      const after = await tick({ health: 0.7 }, 1000);
      expect(value("pain")).toBeCloseTo((after.trace?.vitals as { pain: number }).pain);
      expect(value("pain")).toBeGreaterThan(0.5);
      expect(after.trace?.painDulled).toBeUndefined();
    });
  });
});
