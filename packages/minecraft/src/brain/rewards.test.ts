import type { SkillEvent } from "@familiar/contracts";
import type { RewardRule } from "@familiar/neuromodulators";
import { describe, expect, it } from "vitest";
import type { MinecraftStateData } from "../encode/state-data.js";
import { fakeState, type StatePatch } from "../encode/state.test-helper.js";
import {
  damageTaken,
  died,
  firstTool,
  foodBarUp,
  foodStockUp,
  healthUp,
  lostItems,
  reachedLight,
  skillFailed,
  sleptThroughNight,
  threatGone,
  torchesUp,
} from "./rewards.js";

type Patch = Pick<StatePatch, "self" | "time" | "current"> & { mobs?: MinecraftStateData["nearby"]["mobs"] };

/** A bot with a full food stock, so only what a test changes is rewarded. */
const state = ({ mobs = [], self, ...rest }: Patch = {}) => fakeState({ ...rest, self: { foodItems: 8, ...self }, nearby: { mobs } });

const check = (rule: RewardRule, before: Patch, after: Patch, events: SkillEvent[] = []) =>
  rule.check({ before: state(before), after: state(after), events });
const event = (skill: string, type: SkillEvent["type"]): SkillEvent => ({ skill, type, timestamp: 0 });
const zombie = (dist: number) => ({ id: "entity:7", type: "zombie", dist, hostile: true, reachable: true });

describe("player rewards", () => {
  it("rewards eating more when starving than when nearly full", () => {
    expect(check(foodBarUp, { self: { food: 2 } }, { self: { food: 10 } })).toEqual({ amount: expect.closeTo(0.36), reason: "food 2 → 10" });
    expect(check(foodBarUp, { self: { food: 18 } }, { self: { food: 20 } })?.amount).toBeCloseTo(0.01);
    expect(check(foodBarUp, { self: { food: 10 } }, { self: { food: 8 } })).toBeNull();
  });

  it("rewards health coming back", () => {
    expect(check(healthUp, { self: { health: 10 } }, { self: { health: 14 } })?.amount).toBeCloseTo(0.1);
  });

  it("rewards a close hostile going away, only once none is close", () => {
    expect(check(threatGone, { mobs: [zombie(2)] }, {})).toEqual({ amount: expect.closeTo(0.5625), reason: "zombie gone" });
    expect(check(threatGone, { mobs: [zombie(2)] }, { mobs: [zombie(6)] })).toBeNull();
    expect(check(threatGone, { mobs: [zombie(12)] }, {})).toBeNull();
  });

  it("rewards reaching light at night only", () => {
    const dark = { time: { isNight: true, lightLevel: 0 } };
    expect(check(reachedLight, dark, { time: { isNight: true, lightLevel: 15 } })?.amount).toBe(1);
    expect(check(reachedLight, { time: { lightLevel: 0 } }, { time: { lightLevel: 15 } })).toBeNull();
  });

  it("rewards sleeping through the night", () => {
    expect(check(sleptThroughNight, {}, {}, [event("sleep", "done")])).toEqual({ amount: 1, reason: "slept through the night" });
    expect(check(sleptThroughNight, {}, { time: { isNight: true } }, [event("sleep", "done")])).not.toBeNull(); // the clock lags a tick
    expect(check(sleptThroughNight, { self: { health: 20 } }, { self: { health: 15 } }, [event("sleep", "done")])).toBeNull(); // woken by a hit
    expect(check(sleptThroughNight, {}, {}, [event("sleep", "failed")])).toBeNull();
  });

  it("rewards the first tool of each kind, but not a pickaxe as an axe", () => {
    expect(check(firstTool, {}, { self: { inventory: { stone_pickaxe: 1, wooden_sword: 1 } } })).toEqual({ amount: 2, reason: "first sword, pickaxe" });
    expect(check(firstTool, { self: { inventory: { wooden_sword: 1 } } }, { self: { inventory: { stone_sword: 1, wooden_sword: 1 } } })).toBeNull();
  });

  it("rewards stocking up only while short", () => {
    expect(check(foodStockUp, { self: { foodItems: 0 } }, { self: { foodItems: 4 } })?.amount).toBeCloseTo(0.5);
    expect(check(foodStockUp, { self: { foodItems: 8 } }, { self: { foodItems: 20 } })).toBeNull();
    expect(check(torchesUp, {}, { self: { inventory: { torch: 16 } } })).toEqual({ amount: 1, reason: "torches 0 → 16" });
  });

  it("punishes damage and death", () => {
    expect(check(damageTaken, { self: { health: 20 } }, { self: { health: 15 } })).toEqual({ amount: -0.25, reason: "health 20 → 15" });
    expect(check(died, {}, { self: { deaths: 1 } })).toEqual({ amount: -1, reason: "died", fatal: true });
  });

  it("punishes lost items, unless a skill spent them", () => {
    const had = { self: { inventory: { bread: 4, stone_sword: 1 } } };
    expect(check(lostItems, had, { self: { inventory: { bread: 4 } } })).toEqual({ amount: -1 / 64, reason: "lost stone_sword" });
    expect(check(lostItems, had, { self: { inventory: { stone_sword: 1 } } }, [event("eat", "done")])).toBeNull();
    expect(check(lostItems, { ...had, current: { skill: "deposit_items", target: null, secondsRunning: 2 } }, {})).toBeNull();
  });

  it("punishes each failed skill", () => {
    expect(check(skillFailed, {}, {}, [event("go_to", "failed"), event("eat", "done")])).toEqual({ amount: -0.1, reason: "go_to failed" });
    expect(check(skillFailed, {}, {}, [{ ...event("go_to", "failed"), reason: "cannot run" }])).toBeNull();
  });

  it("ignores states that are not Minecraft states", () => {
    expect(foodBarUp.check({ before: { ...state(), schemaVersion: 1 }, after: state(), events: [] })).toBeNull();
  });
});
