import { createWorkspace } from "@familiar/core";
import { createReflexGain, DEFAULT_BRAINSTEM } from "@familiar/region-brainstem";
import { fireRules, type ReflexRule } from "@familiar/region-reflex";
import { describe, expect, it } from "vitest";
import { fakeState, type StatePatch } from "../encode/state.test-helper.js";
import { leaningOf } from "./brainstem.js";
import { cure, DEFAULT_MEDULLA, eatToHeal, eatWhenStarving, HEALING_FOOD, isHarmful, medullaProblem, medullaUrges, needAir, playerVitals, sickOf } from "./medulla.js";
import { drowning } from "./reflexes.js";

const zombie = (dist: number) => ({ id: "entity:1", type: "zombie", dist, hostile: true, reachable: true });
type Scene = { self?: StatePatch["self"]; mobs?: ReturnType<typeof zombie>[]; running?: string };

function workspace(scene: Scene) {
  const store = createWorkspace();
  store.update(fakeState({ self: scene.self ?? {}, nearby: { mobs: scene.mobs ?? [] }, current: scene.running ? { skill: scene.running, target: null, secondsRunning: 1 } : null }), null);
  return store;
}
const check = (rule: ReflexRule, scene: Scene = {}) => rule.check(workspace(scene).viewFor("medulla"));
const under = (air: number) => ({ self: { inWater: true, air } });

describe("need_air (the urge to breathe)", () => {
  const rule = needAir(1);

  it("is silent at air 13, starts at 0.3 at 12, and rises steadily to 0.9 at 7", () => {
    expect(check(rule, under(13))).toBeNull();
    expect(check(rule, under(12))).toEqual({ action: { skill: "surface" }, urgency: 0.3, reason: "air 12/20" });
    expect([11, 10, 9, 8, 7].map((air) => check(rule, under(air))!.urgency)).toEqual([0.42, 0.54, 0.66, 0.78, 0.9].map((u) => expect.closeTo(u)));
  });

  it("hands over at 6: the hard drowning reflex fires there, whatever else", () => {
    expect(check(rule, under(6))).toBeNull();
    expect(check(drowning, under(6))).toMatchObject({ action: { skill: "surface" }, urgency: 1 });
    expect(check(drowning, under(7))).toBeNull();
  });

  it("only under water, and is scaled by its strength", () => {
    expect(check(rule, { self: { inWater: false, air: 9 } })).toBeNull();
    expect(check(needAir(0.5), under(7))?.urgency).toBeCloseTo(0.45);
  });

  it("a goal can hold it back (diving on purpose); drowning cannot be held back", () => {
    const fire = (air: number, holdBack: string[]) => {
      const store = workspace(under(air));
      if (holdBack.length) store.viewFor("prefrontal").setGoal({ text: "Dive to the bottom", steps: [], reason: "", holdBack });
      const gainOf = createReflexGain({ settings: DEFAULT_BRAINSTEM, alarmOf: () => 0.5, leaningOf });
      return fireRules([rule, drowning], store.viewFor("medulla"), gainOf).fired;
    };
    const [free] = fire(8, []);
    const [held] = fire(8, ["need_air", "drowning"]);
    expect(free).toMatchObject({ rule: "need_air", gain: expect.closeTo(1) });
    expect(held!.urgency).toBeCloseTo(free!.urgency * 0.3);
    // You can hold your breath, but not forever: at 6 the hard reflex fires at full urgency regardless.
    expect(fire(6, ["need_air", "drowning"])).toEqual([{ rule: "drowning", kind: "hard", skill: "surface", base: 1, gain: 1, urgency: 1 }]);
  });
});

describe("eat_to_heal", () => {
  const rule = eatToHeal(1);
  const hurt = { health: 10, food: 15, foodItems: 3 };

  it("fires when hurt, below the level the body needs to heal, and carrying safe food: eat up to that level", () => {
    expect(HEALING_FOOD).toBe(18);
    expect(check(rule, { self: hurt })).toEqual({ action: { skill: "eat", target: "level:18" }, urgency: 0.5, reason: "health 10/20 cannot heal at food 15/20" });
    expect(check(rule, { self: { ...hurt, food: 17 } })).not.toBeNull();
  });

  it("does not fire at full health, when the food bar is already at healing level, or with nothing safe to eat", () => {
    expect(check(rule, { self: { ...hurt, health: 20 } })).toBeNull();
    expect(check(rule, { self: { ...hurt, food: 18 } })).toBeNull();
    expect(check(rule, { self: { ...hurt, foodItems: 0 } })).toBeNull();
    // Food it knows to be bad does not count: it would rather stay hurt than poison itself.
    expect(check(rule, { self: { ...hurt, foodItems: 0, badFoodItems: 5 } })).toBeNull();
  });

  it("does not fire with a hostile in contact, or while a hard reflex's skill is running", () => {
    expect(check(rule, { self: hurt, mobs: [zombie(2)] })).toBeNull();
    expect(check(rule, { self: hurt, mobs: [zombie(8)] })).not.toBeNull();
    for (const running of ["escape_hazard", "surface", "withdraw"]) expect(check(rule, { self: hurt, running }), running).toBeNull();
  });
});

describe("eat_when_starving", () => {
  const starving = eatWhenStarving(1);
  it("eats when starving and carrying food, and not when fed or without food", () => {
    expect(check(starving, { self: { food: 5, foodItems: 2 } })).toMatchObject({ action: { skill: "eat" }, urgency: 0.9 });
    expect(check(starving, { self: { food: 12, foodItems: 2 } })).toBeNull();
    expect(check(starving, { self: { food: 3, foodItems: 0 } })).toBeNull();
  });

  it("eats food known to be bad only when starving with nothing else", () => {
    expect(check(starving, { self: { food: 5, foodItems: 0, badFoodItems: 2 } })).toMatchObject({ action: { skill: "eat" }, reason: "food 5/20, with only bad food to eat" });
    expect(check(starving, { self: { food: 5, foodItems: 0, badFoodItems: 0 } })).toBeNull();
    expect(check(starving, { self: { food: 7, foodItems: 0, badFoodItems: 2 } })).toBeNull();
  });

  it("does not stop to eat with a hostile in contact", () => {
    expect(check(starving, { self: { food: 3, foodItems: 2 }, mobs: [zombie(2)] })).toBeNull();
    expect(check(starving, { self: { food: 3, foodItems: 2 } })).toMatchObject({ urgency: 0.9 });
  });
});

describe("cure", () => {
  const rule = cure(1);

  it("drinks milk when sick with something it cures and carrying some", () => {
    expect(check(rule, { self: { effects: ["poison"], inventory: { milk_bucket: 1 } } })).toEqual({ action: { skill: "consume", target: "item:milk_bucket" }, urgency: 0.7, reason: "poison, and carrying milk_bucket" });
  });

  it("does nothing when well, without the cure, or for an effect that is not an illness", () => {
    expect(check(rule, { self: { effects: [], inventory: { milk_bucket: 1 } } })).toBeNull();
    expect(check(rule, { self: { effects: ["poison"], inventory: {} } })).toBeNull();
    expect(check(rule, { self: { effects: ["regeneration"], inventory: { milk_bucket: 1 } } })).toBeNull();
  });
});

describe("vital signs", () => {
  const vitals = (self: StatePatch["self"]) => playerVitals(fakeState({ self }))!;

  it("reads hurt, hunger, breath, reserve, cold and tired from the state", () => {
    expect(vitals({ health: 15, food: 5, air: 10, saturation: 5, freezing: 0.4, sinceSleepMinutes: 2160, deaths: 2 })).toEqual({ health: 0.75, air: 0.5, hunger: 0.75, sick: 0, cold: 0.4, tired: 0.5, reserve: 0.25, deaths: 2 });
    expect(playerVitals({ schemaVersion: 0, tick: 0, timestamp: 0, data: {} })).toBeNull();
  });

  it("tired reaches 1 at three game days without sleep, and stays there", () => {
    expect([0, 1440, 4320, 9000].map((m) => vitals({ sinceSleepMinutes: m }).tired)).toEqual([0, expect.closeTo(1 / 3), 1, 1]);
  });

  it("sick is 1 while poisoned or withering, lower for milder effects, 0 otherwise: the worst of them", () => {
    expect([sickOf(["poison"]), sickOf(["wither"]), sickOf(["hunger"]), sickOf(["nausea"]), sickOf([]), sickOf(["regeneration", "speed"])]).toEqual([1, 1, 0.5, 0.4, 0, 0]);
    expect(sickOf(["hunger", "poison", "slowness"])).toBe(1);
    expect([isHarmful("poison"), isHarmful("regeneration")]).toEqual([true, false]);
  });
});

describe("the medulla's settings", () => {
  it("has the four urges, each switched off by its strength", () => {
    expect(medullaUrges(DEFAULT_MEDULLA).map((r) => `${r.name}:${r.kind}`)).toEqual(["need_air:soft", "eat_to_heal:soft", "cure:soft", "eat_when_starving:soft"]);
    expect(medullaUrges({ ...DEFAULT_MEDULLA, needAir: 0, eatToHeal: 0, cure: 0, starving: 0 })).toEqual([]);
  });

  it("validates: a list of foods, and strengths from 0 to 1", () => {
    expect(medullaProblem(DEFAULT_MEDULLA)).toBeNull();
    expect(medullaProblem({ ...DEFAULT_MEDULLA, innateBadFoods: [] })).toBeNull();
    expect(medullaProblem({ ...DEFAULT_MEDULLA, needAir: 1.2 })).toMatch(/medulla.needAir must be 0 to 1/);
  });
});
