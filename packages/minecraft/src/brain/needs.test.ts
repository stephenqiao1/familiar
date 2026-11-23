// The player's needs read through the real hypothalamus (with the real medulla before it): what
// each drive part adds, and that with every part off the reading is the plain one.

import type { NeedReading, RegionOutput } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { createMedullaRegion } from "@familiar/region-brainstem";
import { createHypothalamusRegion, createTargetMemory, DEFAULT_DRIVES, DRIVES_OFF, readNeeds, type DriveSettings, type TargetMemory } from "@familiar/region-hypothalamus";
import { describe, expect, it } from "vitest";
import { fakeState, type StatePatch } from "../encode/state.test-helper.js";
import { playerVitals } from "./medulla.js";
import { bodyNeeds, livesOf, needsNow, playerDayTime, playerNeeds, TARGET_ADJUSTMENTS } from "./needs.js";

const signal = new AbortController().signal;
const husk = (dist: number) => ({ id: "entity:9", type: "husk", dist, hostile: true, reachable: true });
const only = (part: Partial<DriveSettings>): DriveSettings => ({ ...DRIVES_OFF, ...part });

/** A body with the medulla and the hypothalamus, lived through a list of moments (seconds, patch). */
function body(settings: DriveSettings, more: { targets?: TargetMemory; relieving?: (need: string) => boolean; alarm?: () => number; knows?: string[] } = {}) {
  const store = createWorkspace();
  const medulla = createMedullaRegion({ vitals: playerVitals, share: 1 });
  const hypothalamus = createHypothalamusRegion({
    needs: [...playerNeeds, ...bodyNeeds(settings.body)],
    settings,
    load: (ws) => ({ alarm: more.alarm?.() ?? 0, pain: ws.signals.pain?.value ?? 0, poorVitals: 1 - (ws.signals.vitals?.value ?? 1) }),
    dayTime: playerDayTime,
    adjustments: TARGET_ADJUSTMENTS,
    ...(more.targets ? { targets: more.targets } : {}),
    relieving: (_ws, need) => more.relieving?.(need) ?? false,
    relief: (_ws, need) => (more.knows ?? []).includes(need),
    life: livesOf,
  });
  let trace: Record<string, unknown> = {};
  return {
    at(seconds: number, patch: StatePatch = {}) {
      store.update(fakeState(patch, seconds * 1000), null);
      medulla.run(store.viewFor("medulla"), signal);
      trace = (hypothalamus.run(store.viewFor("hypothalamus"), signal) as RegionOutput).trace ?? {};
      return store.needs()!;
    },
    need: (name: string) => store.needs()!.readings.find((r) => r.name === name) as NeedReading,
    signal: (name: string) => store.viewFor("x").signals[name]?.value,
    trace: () => trace,
    view: () => store.viewFor("x"),
  };
}

describe("with every part off", () => {
  it("the reading is the plain one, moment for moment, and no signal is shared", () => {
    const b = body(DRIVES_OFF);
    const moments: StatePatch[] = [{}, { self: { food: 6, foodItems: 2 } }, { self: { food: 3, health: 8, effects: ["poison"] } }, { nearby: { mobs: [husk(4)] } }, { time: { isNight: true, lightLevel: 2, dayTick: 18_000 }, self: { sinceSleepMinutes: 3000 } }];
    moments.forEach((patch, i) => {
      const needs = b.at(i * 30, patch);
      const plain = needs.readings.map(({ tuned: _tuned, ...reading }) => reading);
      expect(plain).toEqual(readNeeds(playerNeeds, b.view().state));
      expect(plain).toEqual(needsNow({ needs: null, state: b.view().state }));
      expect(needs.clock).toBeUndefined();
      expect(needs.desperate).toBeNull();
    });
    for (const name of ["stress", "desperate", "unmet"]) expect(b.signal(name)).toBeUndefined();
  });
});

describe("the body's readings as needs", () => {
  it("cold, tiredness and illness are needs, read from the medulla's signals in steps", () => {
    const b = body(only({ body: 1 }));
    b.at(0, { self: { freezing: 0.5, sinceSleepMinutes: 2160, effects: ["poison"] } });
    expect(b.need("warmth")).toMatchObject({ kind: "warmth", level: 0.5, weight: 1 });
    expect(b.need("rest")).toMatchObject({ kind: "rest", level: 0.5 });
    expect(b.need("illness")).toMatchObject({ kind: "illness", level: 1 });
  });
  it("with the medulla left out there is nothing to read, and the needs are not there", () => {
    const store = createWorkspace();
    store.update(fakeState({ self: { effects: ["poison"] } }, 0), null);
    createHypothalamusRegion({ needs: [...playerNeeds, ...bodyNeeds(1)], settings: only({ body: 1 }) }).run(store.viewFor("hypothalamus"), signal);
    expect(store.needs()!.readings.map((r) => r.name)).toEqual(readNeeds(playerNeeds, store.viewFor("x").state).map((r) => r.name));
  });
});

describe("moving targets", () => {
  it("enough food is more while hurt, and enough torches more underground; the level follows the target", () => {
    const b = body(only({ targets: 1 }));
    b.at(0, { self: { foodItems: 8, inventory: { torch: 16 } } });
    expect(b.need("food_stock")).toMatchObject({ level: 0, target: 8 });
    b.at(1, { self: { foodItems: 8, health: 6, inventory: { torch: 16 }, position: { x: 0, y: 20, z: 0 } } });
    expect(b.need("food_stock")).toMatchObject({ target: 12 });
    expect(b.need("food_stock").level).toBeCloseTo(1 - 8 / 12);
    expect(b.need("torches")).toMatchObject({ target: 24 });
  });
  it("enough food and torches rise as night comes (with the clock on), and stay raised by night", () => {
    const b = body(only({ targets: 1, clock: 1 }));
    b.at(0, { time: { dayTick: 6000 } });
    expect([b.need("food_stock").target, b.need("torches").target]).toEqual([8, 16]);
    b.at(1, { time: { dayTick: 13_000 - 1800 } });
    expect(b.need("food_stock").target).toBeCloseTo(10);
    expect(b.need("torches").target).toBeCloseTo(20);
    b.at(2, { time: { isNight: true, lightLevel: 15, dayTick: 18_000 } });
    expect([b.need("food_stock").target, b.need("torches").target]).toEqual([12, 24]);
  });
  it("running out while the need it serves presses raises enough by a quarter, each time; not otherwise, and not for a new body", () => {
    const targets = createTargetMemory();
    const b = body(only({ learnTargets: 1 }), { targets });
    b.at(0, { self: { foodItems: 3, food: 8 } });
    b.at(1, { self: { foodItems: 0, food: 20 } }); // none left, but not hungry: no shortage
    expect(b.trace().learned).toBeUndefined();
    b.at(2, { self: { foodItems: 0, food: 8 } }); // none left and the food bar under half
    expect(b.trace().learned).toEqual(["food_stock: ran out with food_bar pressing, enough is now 1.25× the usual"]);
    b.at(3, { self: { foodItems: 0, food: 7 } }); // the same shortage, not a second one
    expect(b.trace().learned).toBeUndefined();
    b.at(4, { self: { foodItems: 10, food: 20 } });
    expect(b.need("food_stock").target).toBeCloseTo(10, 2);
    expect(b.need("food_stock").level).toBe(0);
    b.at(5, { self: { foodItems: 0, food: 6 } });
    expect(targets.get("food_stock", 5000)).toBeCloseTo(1.5625, 2);
    b.at(6, { self: { foodItems: 5, food: 20 } });
    b.at(7, { self: { foodItems: 0, food: 2, deaths: 1 } });
    expect(b.trace().learned).toBeUndefined();
    expect(Object.keys(targets.entries())).toEqual(["food_stock"]);
  });
  it("no torch in the dark is a shortage of torches", () => {
    const targets = createTargetMemory();
    const b = body(only({ learnTargets: 1 }), { targets });
    b.at(0, { self: { inventory: { torch: 2 } } });
    b.at(1, { time: { isNight: true, lightLevel: 2 }, self: { inventory: {} } });
    expect(targets.get("torches", 1000)).toBeCloseTo(1.25);
  });
});

describe("looking ahead", () => {
  it("a food bar that is falling presses before it is empty; the level is the real one; a steady one does not", () => {
    const b = body(only({ lookAhead: 1 }));
    for (let s = 0; s <= 30; s += 5) b.at(s, { self: { food: 16 - s / 5, saturation: 5 } });
    expect(b.need("food_bar").level).toBeCloseTo(0.5);
    expect(b.need("food_bar").projected).toBe(1);
    expect(b.need("food_bar").pressing).toBeCloseTo(0.7);
    const steady = body(only({ lookAhead: 1 }));
    for (let s = 0; s <= 30; s += 5) steady.at(s, { self: { food: 10, saturation: 5 } });
    expect(steady.need("food_bar")).toMatchObject({ level: 0.5, pressing: 0.5 });
  });
  it("hungry soon: a full food bar with the reserve gone already presses; with a reserve it does not", () => {
    const b = body(only({ lookAhead: 1 }));
    b.at(0, { self: { food: 20, saturation: 0 } });
    expect(b.need("food_bar")).toMatchObject({ level: 0, projected: 0.5 });
    expect(b.need("food_bar").pressing).toBeCloseTo(0.35);
    b.at(1, { self: { food: 20, saturation: 5 } });
    expect(b.need("food_bar")).toMatchObject({ level: 0, pressing: 0 });
  });
  it("the dark comes on over dusk and presses ahead of itself, so the bot is moved before night falls; by a lamp it is not", () => {
    const b = body(only({ lookAhead: 1, clock: 1 }));
    b.at(0, { time: { dayTick: 6000 } });
    expect(b.view().needs!.readings.find((r) => r.name === "night_light")).toBeUndefined(); // by day it is not a need
    // The last three minutes of the day, a state every ten seconds, under the open sky.
    for (let s = 0; s <= 90; s += 10) b.at(10 + s, { time: { dayTick: 13_000 - 3600 + s * 20, lightLevel: 15 }, self: { skyLight: 15 } });
    const dusk = b.need("night_light");
    expect(dusk.level).toBeCloseTo(0.5 * (1 - 4 / 15));
    expect(dusk.projected).toBeCloseTo(dusk.level + (1 - 4 / 15) / 3, 1);
    expect(dusk.pressing).toBeGreaterThan(dusk.level);
    const lit = body(only({ lookAhead: 1, clock: 1 }));
    lit.at(0, { time: { dayTick: 13_000 - 1800, lightLevel: 15, blockLight: 14 }, self: { skyLight: 15 } });
    expect(lit.need("night_light").level).toBeCloseTo(0.5 / 15);
    // With the clock off it is as before: not a need until night.
    const plain = body(only({ lookAhead: 1 }));
    plain.at(0, { time: { dayTick: 13_000 - 900 } });
    expect(plain.view().needs!.readings.find((r) => r.name === "night_light")).toBeUndefined();
  });
  it("a need eases by a third while a skill learned to relieve it runs", () => {
    const b = body(only({ lookAhead: 1 }), { relieving: (need) => need === "food_bar" });
    b.at(0, { self: { food: 8 } });
    expect(b.need("food_bar")).toMatchObject({ level: 0.6 });
    expect(b.need("food_bar").pressing).toBeCloseTo(0.4);
  });
});

describe("the body clock", () => {
  it("shares where in the day it is, with dusk over the last three minutes of the day", () => {
    const b = body(only({ clock: 1 }));
    expect(b.at(0, { time: { dayTick: 6000 } }).clock).toMatchObject({ night: false, dusk: 0 });
    expect(b.at(1, { time: { dayTick: 13_000 - 1800 } }).clock?.dusk).toBeCloseTo(0.5);
    expect(b.at(2, { time: { isNight: true, dayTick: 18_000 } }).clock).toMatchObject({ night: true, dusk: 0 });
    expect(b.at(3, {}).clock).toBeUndefined(); // a state made without a clock
  });
  it("stocking up presses half as hard by night; rest half as hard by day", () => {
    const b = body(only({ clock: 1, body: 1 }));
    b.at(0, { time: { dayTick: 6000 }, self: { sinceSleepMinutes: 2160 } });
    expect([b.need("food_stock").pressing, b.need("rest").pressing]).toEqual([1, 0.25]);
    b.at(1, { time: { isNight: true, lightLevel: 15, dayTick: 18_000 }, self: { sinceSleepMinutes: 2160 } });
    expect([b.need("food_stock").pressing, b.need("rest").pressing]).toEqual([0.5, 0.5]);
  });
});

describe("stress", () => {
  it("builds over a minute with a threat close, is still there minutes after it has gone, and holds back what can wait", () => {
    const b = body(only({ stress: 1 }));
    for (let s = 0; s <= 90; s += 5) b.at(s, { nearby: { mobs: [husk(2)] } });
    const peak = b.signal("stress")!;
    expect(peak).toBeGreaterThan(0.5);
    for (let s = 95; s <= 210; s += 5) b.at(s);
    expect(b.signal("stress")).toBeGreaterThan(0.6 * peak);
    expect(b.need("food_stock").pressing).toBeLessThan(0.85);
    expect(b.need("food_stock").level).toBe(1);
    for (let s = 215; s <= 1500; s += 5) b.at(s);
    expect(b.signal("stress")).toBeLessThan(0.05);
  });
  it("takes the largest of alarm, threat, pain and poor vitals, not their sum", () => {
    const b = body(only({ stress: 1 }), { alarm: () => 0.6 });
    b.at(0, { nearby: { mobs: [husk(8)] }, self: { food: 10 } });
    expect(b.trace()).toMatchObject({ load: 0.6, loadBy: "alarm" });
  });
});

describe("competition", () => {
  it("names the need the body wants most, and says when a need of the body is desperate", () => {
    const b = body(only({ desperate: 1 }));
    expect(b.at(0, { self: { food: 12, foodItems: 8, inventory: { torch: 16, stone_sword: 1, stone_pickaxe: 1, stone_axe: 1, stone_shovel: 1 } } })).toMatchObject({ top: { name: "food_bar", kind: "hunger" }, desperate: null });
    expect(b.at(1, { self: { food: 1 } })).toMatchObject({ top: { name: "food_bar" }, desperate: "food_bar" });
    expect(b.signal("desperate")).toBeCloseTo(0.75);
    // Danger silences the rest, and is then what the body wants most; hunger is still desperate.
    expect(b.at(2, { self: { food: 1 }, nearby: { mobs: [husk(3)] } })).toMatchObject({ top: { name: "danger", kind: "safety" }, desperate: "food_bar" });
  });
  it("unmet: the top need presses and nothing learned relieves it; it clears once something is known, or nothing presses", () => {
    const fed = { foodItems: 8, inventory: { torch: 16, stone_sword: 1, stone_pickaxe: 1, stone_axe: 1, stone_shovel: 1 } };
    const naive = body(only({ unmet: 1 }));
    expect(naive.at(0, { self: { ...fed, food: 4 } })).toMatchObject({ unmet: true });
    expect(naive.signal("unmet")).toBeCloseTo(0.8);
    expect(naive.at(1, { self: fed })).toMatchObject({ top: null, unmet: false });
    expect(naive.signal("unmet")).toBe(0);
    const taught = body(only({ unmet: 1 }), { knows: ["food_bar"] });
    expect(taught.at(0, { self: { ...fed, food: 4 } })).toMatchObject({ unmet: false });
    expect(taught.signal("unmet")).toBe(0);
  });
});

describe("guardrails", () => {
  it("every signal it shares stays within 0 to 1, and a tick takes well under 2 ms", () => {
    const b = body(DEFAULT_DRIVES, { alarm: () => 5 });
    const started = performance.now();
    for (let s = 0; s < 600; s += 3) b.at(s, { self: { food: s % 20, health: 1 + (s % 19), foodItems: s % 3, effects: s % 7 ? [] : ["poison"], sinceSleepMinutes: s * 10 }, nearby: { mobs: s % 5 ? [] : [husk(1 + (s % 9))] }, time: { dayTick: (s * 40) % 24_000, isNight: (s * 40) % 24_000 > 13_000 } });
    for (const name of ["stress", "desperate", "unmet"]) {
      expect(b.signal(name)).toBeGreaterThanOrEqual(0);
      expect(b.signal(name)).toBeLessThanOrEqual(1);
    }
    for (const r of b.view().needs!.readings) expect(r.pressing >= 0 && r.pressing <= 1 && r.level >= 0 && r.level <= 1).toBe(true);
    // 200 ticks of the medulla and the hypothalamus together, the first (cold) ones included. The region logs its own worst tick.
    expect((performance.now() - started) / 200).toBeLessThan(0.5);
    expect(b.trace().worstMs).toEqual(expect.any(Number));
  });
});
