import { describe, expect, it } from "vitest";
import type { Feeling, SkillEvent, State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { FEAR_SIGNAL } from "@familiar/region-amygdala";
import { AROUSAL_SIGNAL, COLD_SIGNAL, PAIN_SIGNAL, SICK_SIGNAL, SORE_SIGNAL, TIRED_SIGNAL } from "@familiar/region-brainstem";
import { STRESS_SIGNAL } from "@familiar/region-hypothalamus";
import { createInsulaRegion, DEFAULT_INSULA } from "@familiar/region-insula";
import { SCHEMA_VERSION } from "../encode/encode-state.js";
import type { MinecraftStateData } from "../encode/state-data.js";
import { fakeData } from "../encode/state.test-helper.js";
import { describeSituation } from "./situation.js";
import { FEELING_WORDS, playerBody, playerExplains, playerInsula, playerReadings, withFeeling } from "./insula.js";

type Self = Partial<MinecraftStateData["self"]>;
const stateOf = (self: Self, timestamp = 1000): State => ({ schemaVersion: SCHEMA_VERSION, tick: 0, timestamp, data: { ...fakeData({ self }) } });
function ws(self: Self = {}, signals: Record<string, number> = {}, events: SkillEvent[] = [], running?: string) {
  const store = createWorkspace();
  store.update(stateOf(self), running ? { skill: running, target: undefined, startedAt: 0 } : null);
  for (const [name, value] of Object.entries(signals)) store.viewFor("test").setSignal(name, value);
  for (const event of events) store.addEvent(event);
  return store.viewFor("insula");
}
const level = (word: string, self: Self = {}, signals: Record<string, number> = {}) => playerReadings(ws(self, signals)).find((r) => r.word === word)!.level;

describe("the player's feelings", () => {
  it("each reading gives its word", () => {
    expect(FEELING_WORDS).toEqual(["hungry", "hurting", "tired", "cold", "sick", "short of breath", "afraid", "tense"]);
    expect(level("hungry", { food: 5 })).toBeCloseTo(0.75);
    expect(level("hurting", { health: 14 })).toBeCloseTo(0.3);
    expect(level("tired", {}, { [TIRED_SIGNAL]: 0.6 })).toBe(0.6);
    expect(level("cold", { freezing: 0.4 })).toBe(0.4);
    expect(level("cold", {}, { [COLD_SIGNAL]: 0.7 })).toBe(0.7);
    expect(level("sick", {}, { [SICK_SIGNAL]: 1 })).toBe(1);
    expect(level("short of breath", { air: 5 })).toBeCloseTo(0.75);
    expect(level("afraid", {}, { [FEAR_SIGNAL]: 0.5 })).toBe(0.5);
  });

  it("hurting is the standing loss of health or the fresh sting, whichever is stronger; tense is stress or being wound up", () => {
    expect(level("hurting", { health: 20 }, { [PAIN_SIGNAL]: 0.8 })).toBe(0.8);
    expect(level("hurting", { health: 20 }, { [SORE_SIGNAL]: 1 })).toBe(0.5);
    expect(level("tense", {}, { [STRESS_SIGNAL]: 0.4 })).toBe(0.4);
    expect(level("tense", {}, { [AROUSAL_SIGNAL]: 0.5 })).toBe(0);
    expect(level("tense", {}, { [AROUSAL_SIGNAL]: 0.85 })).toBeCloseTo(0.5);
  });

  it("a healthy, fed, rested bot feels nothing: it is at ease", () => {
    const store = createWorkspace();
    store.update(stateOf({}), null);
    createInsulaRegion({ ...playerInsula(), settings: DEFAULT_INSULA }).run(store.viewFor("insula"), new AbortController().signal);
    expect(store.feeling()).toMatchObject({ feelings: [], comfort: 1, line: "at ease" });
    expect(playerReadings(createWorkspace().viewFor("insula"))).toEqual([]);
  });

  it("watches health, food and breath for a change", () => {
    expect(playerBody(ws({ health: 10, food: 15, air: 20 }))).toEqual({ health: 0.5, food: 0.75, breath: 1 });
  });
});

describe("what explains the body changing", () => {
  const hit = (by: string | null, kind: string | null, msAgo = 500) => ({ lastHurt: { msAgo, by, kind, at: { x: 0, y: 0, z: 0 } } });

  it("health falling: a hit that could be seen, a fall, fire, drowning, starving or an illness; a hit with nothing to see, or none at all, explains nothing", () => {
    expect(playerExplains("health", -0.2, ws(hit("zombie", "mob_attack")))).toBe("mob_attack");
    expect(playerExplains("health", -0.2, ws(hit(null, "fall")))).toBe("fall");
    expect(playerExplains("health", -0.2, ws({ onFire: true }))).not.toBeNull();
    expect(playerExplains("health", -0.2, ws({ air: 0, inWater: true }))).toBe("drowning");
    expect(playerExplains("health", -0.2, ws({ food: 0 }))).toBe("starving");
    expect(playerExplains("health", -0.2, ws({ effects: ["poison"] }))).toBe("illness");
    expect(playerExplains("health", -0.2, ws(hit(null, "magic")))).toBeNull();
    expect(playerExplains("health", -0.2, ws(hit("zombie", "mob_attack", 20_000)))).toBeNull();
    expect(playerExplains("health", -0.2, ws())).toBeNull();
    expect(playerExplains("health", 0.2, ws())).toBe("healing");
  });

  it("food rising: a meal just eaten or under way; falling: the hunger effect; breath: water", () => {
    const ate: SkillEvent = { skill: "eat", type: "done", timestamp: 800 };
    expect(playerExplains("food", 0.4, ws({}, {}, [ate]))).toBe("eat");
    expect(playerExplains("food", 0.4, ws({}, {}, [], "consume"))).toBe("consume");
    expect(playerExplains("food", 0.4, ws({}, {}, [{ ...ate, timestamp: -10_000 }]))).toBeNull();
    expect(playerExplains("food", -0.2, ws({ effects: ["hunger"] }))).toBe("the hunger effect");
    expect(playerExplains("food", -0.2, ws())).toBeNull();
    expect(playerExplains("breath", -0.2, ws({ inWater: true }))).not.toBeNull();
    expect(playerExplains("breath", -0.2, ws())).toBeNull();
  });
});

describe("telling the deciding layers", () => {
  const feeling: Feeling = { feelings: [{ word: "hungry", strength: 0.8, from: "hunger" }], comfort: 0.2, mood: 0, uneasy: { level: 0, about: [] }, line: "very hungry" };
  const view = stateOf({ food: 4, health: 18 });
  const self = (state: State) => (state.data as unknown as MinecraftStateData).self as MinecraftStateData["self"] & { feels?: string };

  it("the line goes with the body, beside the numbers; the line alone leaves out the numbers it restates and nothing else", () => {
    const both = self(withFeeling(view, feeling, { line: true, numbers: true }));
    expect(both).toMatchObject({ feels: "very hungry", food: 4, health: 18 });
    const alone = self(withFeeling(view, feeling, { line: true, numbers: false }));
    expect(alone.feels).toBe("very hungry");
    for (const key of ["health", "food", "saturation", "air", "freezing", "sinceSleepMinutes", "healing"]) expect(key in alone).toBe(false);
    expect(alone).toMatchObject({ position: self(view).position, inventory: {}, foodItems: 0, heldItem: null });
    expect(Object.keys(alone).length).toBe(Object.keys(self(view)).length + 1 - 7);
  });

  it("the numbers alone, or no feeling at all, leave the view as it is; the full state is never touched", () => {
    expect(withFeeling(view, feeling, { line: false, numbers: true })).toBe(view);
    expect(withFeeling(view, null, { line: true, numbers: false })).toBe(view);
    withFeeling(view, feeling, { line: true, numbers: false });
    expect(self(view)).toMatchObject({ food: 4, health: 18 });
    expect("feels" in self(view)).toBe(false);
  });

  it("the planner's situation says the line, and without the numbers says what is carried instead", () => {
    const told = (state: State) => {
      const store = createWorkspace();
      store.update(state, null);
      return describeSituation(store.viewFor("prefrontal"), []);
    };
    expect(told(view)).toContain("Health 18/20, food 4/20 (0 food items).");
    expect(told(view)).not.toContain("Feels:");
    const both = told(withFeeling(view, feeling, { line: true, numbers: true }));
    expect(both).toContain("Feels: very hungry.\nHealth 18/20, food 4/20 (0 food items).");
    const alone = told(withFeeling(view, feeling, { line: true, numbers: false }));
    expect(alone).toContain("Feels: very hungry.\nCarrying 0 food items.");
    expect(alone).not.toContain("Health");
  });
});
