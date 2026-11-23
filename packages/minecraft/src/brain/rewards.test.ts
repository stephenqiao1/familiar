import type { SkillEvent } from "@familiar/contracts";
import type { Reward, RewardRule } from "@familiar/neuromodulators";
import { describe, expect, it } from "vitest";
import type { MinecraftStateData } from "../encode/state-data.js";
import { fakeState, type StatePatch } from "../encode/state.test-helper.js";
import { danger, foodBar, foodStock, health, nightLight, playerNeeds, tools, torches } from "./needs.js";
import { curiosity, died, playerRewards, newLife, skillFailed, sleptThroughNight } from "./rewards.js";
import { createNoveltyMemory, needChangeReward } from "@familiar/neuromodulators";
import { readNeeds, type Need } from "@familiar/region-hypothalamus";
import type { State } from "@familiar/contracts";

/** A need as the reward it pays: the signed change in its level, the way the dopamine region pays it. */
const paid = (need: Need): RewardRule => ({
  name: need.name,
  need: need.kind,
  check(moment) {
    const plain = { signal: () => undefined, target: need.target ?? 0, clock: null };
    const [a, b] = [need.level(moment.before, plain), need.level(moment.after, plain)];
    return a === null || b === null || a === b || newLife(moment) ? null : { amount: needChangeReward(a, b), reason: need.say!(moment.before, moment.after) };
  },
});
const asRule = (rule: RewardRule | Need): RewardRule => ("check" in rule ? rule : paid(rule));
/** Each need's level, and how hard each presses, as the hypothalamus reads them. */
const needLevels = (_rules: unknown, s: State) => Object.fromEntries(readNeeds(playerNeeds, s).map((r) => [r.name, r.level]));
const pressingNow = (_rules: unknown, s: State) => Object.fromEntries(readNeeds(playerNeeds, s).map((r) => [r.name, r.pressing]));

type Patch = Pick<StatePatch, "self" | "time" | "current"> & { mobs?: MinecraftStateData["nearby"]["mobs"] };

/** A bot with a full food stock, so only what a test changes is rewarded. */
const state = ({ mobs = [], self, ...rest }: Patch = {}) => fakeState({ ...rest, self: { foodItems: 8, ...self }, nearby: { mobs } });

/** Everything a rule pays for the change from one state to another. */
const checkAll = (rule: RewardRule | Need, before: Patch, after: Patch, events: SkillEvent[] = []) => asRule(rule).check({ before: state(before), after: state(after), events });
/** The one reward a rule pays (for rules that pay at most one). */
const check = (rule: RewardRule | Need, before: Patch, after: Patch, events: SkillEvent[] = []): Reward | null => {
  const found = checkAll(rule, before, after, events);
  return Array.isArray(found) ? (found[0] ?? null) : found;
};
const event = (skill: string, type: SkillEvent["type"]): SkillEvent => ({ skill, type, timestamp: 0 });
/** A zombie that has not noticed the bot (it is not closing). */
const zombie = (dist: number) => ({ id: "entity:7", type: "zombie", dist, hostile: true, reachable: true, closing: 0 });

/** What a need pays for going there and back again: always nothing. */
const roundTrip = (rule: RewardRule | Need, here: Patch, there: Patch) => (check(rule, here, there)?.amount ?? 0) + (check(rule, there, here)?.amount ?? 0);

describe("player rewards", () => {
  it("every need says how pressing it is, by rule name, and the things that only happen do not", () => {
    const short = state({ self: { food: 5, health: 10, foodItems: 2 } });
    const levels = needLevels(playerRewards, short);
    expect(levels).toMatchObject({ food_bar: 0.75, health: 0.5, food_stock: 0.75, danger: 0 });
    expect(levels).not.toHaveProperty("died");
    expect(levels).not.toHaveProperty("skill_failed");
    // By day the dark is no need at all.
    expect(levels).not.toHaveProperty("night_light");
  });

  it("staying alive comes first: a threat silences every other need, however far inside its range", () => {
    const zombie = (dist: number, closing = 0) => [{ id: "entity:1", type: "zombie", dist, hostile: true, reachable: true, closing }];
    const short = { self: { food: 5, health: 10, foodItems: 0 } };
    const calm = pressingNow(playerRewards, state(short));
    expect(calm).toMatchObject({ food_stock: 1, food_bar: 0.75, health: 0.5, danger: 0 });
    const far = pressingNow(playerRewards, state({ ...short, mobs: zombie(7) })); // just inside
    expect(far.danger).toBeCloseTo(0.125);
    expect(far).toMatchObject({ food_stock: 0, food_bar: 0, health: 0 });
    // Outside the range that counts, one that has not noticed the bot is no threat and silences nothing.
    expect(pressingNow(playerRewards, state({ ...short, mobs: zombie(9) })).food_stock).toBe(1);
    // One that has noticed it (it is coming) counts twice as far off: having run 9 blocks is not being safe.
    const chased = pressingNow(playerRewards, state({ ...short, mobs: zombie(9, 2) }));
    expect(chased.danger).toBeCloseTo(1 - 9 / 16);
    expect(chased.food_stock).toBe(0);
    expect(pressingNow(playerRewards, state({ ...short, mobs: zombie(17, 2) })).food_stock).toBe(1);
    // What is learned from still goes by the true levels.
    expect(needLevels(playerRewards, state({ ...short, mobs: zombie(0) })).food_stock).toBe(1);
  });

  it("a mob that cannot get to the bot is no danger, unless it would blast through the wall or has just hurt it", () => {
    const mob = (type: string, reachable: boolean) => [{ id: "entity:1", type, dist: 4, hostile: true, reachable, closing: 0 }];
    const level = (patch: Patch) => needLevels(playerRewards, state(patch)).danger;
    expect(level({ mobs: mob("husk", true) })).toBeCloseTo(0.5);
    expect(level({ mobs: mob("husk", false) })).toBe(0); // caged, or across a gap
    expect(level({ mobs: mob("creeper", false) })).toBeCloseTo(0.5);
    expect(level({ mobs: mob("husk", false), self: { lastHurt: { by: "entity:1", msAgo: 200, kind: "mob", at: { x: 0, y: 0, z: 0 } } } })).toBeCloseTo(0.75); // having hurt the bot it has noticed it: the wider range
    // So a caged mob quietens nothing, and appearing or leaving pays nothing.
    expect(pressingNow(playerRewards, state({ mobs: mob("husk", false), self: { foodItems: 0 } })).food_stock).toBe(1);
    expect(check(danger, {}, { mobs: mob("husk", false) })).toBeNull();
  });

  it("pays for eating, more when starving than when nearly full, and charges for getting hungrier", () => {
    expect(check(foodBar, { self: { food: 2 } }, { self: { food: 10 } })).toEqual({ amount: expect.closeTo(0.56), reason: "food 2 → 10" });
    expect(check(foodBar, { self: { food: 18 } }, { self: { food: 20 } })?.amount).toBeCloseTo(0.01);
    expect(check(foodBar, { self: { food: 10 } }, { self: { food: 8 } })?.amount).toBeCloseTo(-0.11);
    expect(check(foodBar, { self: { food: 10 } }, { self: { food: 10 } })).toBeNull();
  });

  it("charges for a hurt, more the weaker the bot already is, and pays the same back as it heals", () => {
    expect(check(health, { self: { health: 20 } }, { self: { health: 17 } })?.amount).toBeCloseTo(-0.0225);
    expect(check(health, { self: { health: 6 } }, { self: { health: 3 } })?.amount).toBeCloseTo(-0.2325);
    expect(check(health, { self: { health: 10 } }, { self: { health: 14 } })?.amount).toBeCloseTo(0.16);
    expect(roundTrip(health, { self: { health: 20 } }, { self: { health: 8 } })).toBeCloseTo(0);
  });

  it("charges for a hostile coming close and pays as it gets further away, so coming and going is worth nothing", () => {
    expect(check(danger, {}, { mobs: [zombie(2)] })).toEqual({ amount: expect.closeTo(-0.5625), reason: "zombie at 2 blocks" });
    expect(check(danger, { mobs: [zombie(2)] }, {})).toEqual({ amount: expect.closeTo(0.5625), reason: "zombie gone" });
    // Running away is paid step by step, and adds up to what killing it on the spot would pay.
    const fled = [2, 4, 6, 8].map((dist, i, at) => check(danger, { mobs: [zombie(dist)] }, i + 1 < at.length ? { mobs: [zombie(at[i + 1]!)] } : {})?.amount ?? 0);
    expect(fled[0]).toBeGreaterThan(0);
    expect(fled.reduce((sum, x) => sum + x, 0)).toBeCloseTo(0.5625);
    expect(check(danger, { mobs: [zombie(12)] }, {})).toBeNull();
  });

  it("pays for reaching light at night and charges for leaving it; by day, and at dusk and dawn, light is not a need", () => {
    const dark = { time: { isNight: true, lightLevel: 0 } };
    const lit = { time: { isNight: true, lightLevel: 15 } };
    expect(check(nightLight, dark, lit)?.amount).toBe(1);
    expect(roundTrip(nightLight, dark, lit)).toBe(0);
    expect(check(nightLight, { time: { lightLevel: 0 } }, { time: { lightLevel: 15 } })).toBeNull();
    expect(check(nightLight, { time: { lightLevel: 15 } }, dark)).toBeNull();
  });

  it("rewards sleeping through the night", () => {
    expect(check(sleptThroughNight, {}, {}, [event("sleep", "done")])).toEqual({ amount: 1, reason: "slept through the night", skill: "sleep" });
    expect(check(sleptThroughNight, {}, { time: { isNight: true } }, [event("sleep", "done")])).not.toBeNull(); // the clock lags a tick
    expect(check(sleptThroughNight, { self: { health: 20 } }, { self: { health: 15 } }, [event("sleep", "done")])).toBeNull(); // woken by a hit
    expect(check(sleptThroughNight, {}, {}, [event("sleep", "failed")])).toBeNull();
  });

  it("pays for the first tool of each kind (not a pickaxe as an axe), and charges the same for losing the last", () => {
    const sword = { self: { inventory: { wooden_sword: 1 } } };
    expect(check(tools, {}, sword)).toEqual({ amount: expect.closeTo(0.4375), reason: "now has a sword" });
    expect(check(tools, sword, {})).toEqual({ amount: expect.closeTo(-0.4375), reason: "no sword any more" });
    expect(roundTrip(tools, {}, sword)).toBeCloseTo(0);
    expect(check(tools, sword, { self: { inventory: { stone_sword: 1, wooden_sword: 1 } } })).toBeNull();
    expect(check(tools, {}, { self: { inventory: { stone_pickaxe: 1 } } })?.reason).toBe("now has a pickaxe");
    // All four kinds together are worth 1.
    expect(check(tools, {}, { self: { inventory: { a_sword: 1, a_pickaxe: 1, an_axe: 1, a_shovel: 1 } } })?.amount).toBe(1);
  });

  it("pays for stocking up only while short, and charges for the stock running down", () => {
    expect(check(foodStock, { self: { foodItems: 0 } }, { self: { foodItems: 4 } })?.amount).toBeCloseTo(0.75);
    expect(check(foodStock, { self: { foodItems: 8 } }, { self: { foodItems: 20 } })).toBeNull();
    expect(check(foodStock, { self: { foodItems: 8 } }, { self: { foodItems: 7 } })?.amount).toBeCloseTo(-0.0156);
    expect(check(torches, {}, { self: { inventory: { torch: 16 } } })).toEqual({ amount: 1, reason: "torches 0 → 16" });
    expect(roundTrip(torches, {}, { self: { inventory: { torch: 5 } } })).toBeCloseTo(0);
  });

  it("punishes death, and compares no need across it: coming back to life is not an achievement", () => {
    const dying = { self: { health: 4, food: 3 }, mobs: [zombie(1)] };
    const reborn = { self: { health: 20, food: 20, deaths: 1 } };
    expect(check(died, dying, reborn)).toEqual({ amount: -1, reason: "died", fatal: true });
    for (const rule of [health, foodBar, danger, tools, foodStock, torches, nightLight]) expect(check(rule, dying, reborn)).toBeNull();
    // The dead body, then the new one a tick later: the same.
    const body = { self: { health: 0, food: 3 } };
    expect(check(health, body, { self: { health: 20, food: 20 } })).toBeNull();
    expect(check(foodBar, body, { self: { health: 20, food: 20 } })).toBeNull();
    // The blow that killed it is still a hurt.
    expect(check(health, dying, body)?.amount).toBeLessThan(0);
    expect(newLife({ before: state(dying), after: state(reborn) })).toBe(true);
    expect(newLife({ before: state(dying), after: state(dying) })).toBe(false);
  });

  it("pays nothing for the new sights of a new life", () => {
    const rule = curiosity(createNoveltyMemory());
    rule.check({ before: state(), after: state(), events: [] });
    const reborn = state({ self: { deaths: 1, biome: "desert", inventory: { bread: 1 } } });
    expect(rule.check({ before: state(), after: reborn, events: [] })).toBeNull();
  });

  it("punishes each failed skill", () => {
    expect(checkAll(skillFailed, {}, {}, [event("go_to", "failed"), event("eat", "done"), event("step", "failed")])).toEqual([
      { amount: -0.1, reason: "go_to failed", skill: "go_to" },
      { amount: -0.1, reason: "step failed", skill: "step" },
    ]);
    expect(checkAll(skillFailed, {}, {}, [{ ...event("go_to", "failed"), reason: "cannot run" }])).toEqual([]);
  });

  it("ignores states that are not Minecraft states", () => {
    expect(asRule(foodBar).check({ before: { ...state(), schemaVersion: 1 }, after: state(), events: [] })).toBeNull();
  });
});
