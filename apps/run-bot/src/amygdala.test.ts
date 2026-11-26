import { createAssociations, DEFAULT_AMYGDALA, NO_READERS, type Associations } from "@familiar/region-amygdala";
import { describe, expect, it } from "vitest";
import { playerAmygdala, type AmygdalaParts } from "./amygdala.js";

// What the amygdala's readers outside the brain's list are handed: which blocks hurt, which
// foods are bad, a kind's harm for the threat sense, and what is feared with nothing in view.

const of = (harm: number, safe?: Record<string, number>) => ({ harm, good: 0, sure: 1, at: Date.now(), ...(safe ? { safe: Object.fromEntries(Object.entries(safe).map(([area, value]) => [area, { value, at: Date.now() }])) } : {}) });

function wired(held: Associations, over: Partial<AmygdalaParts> = {}) {
  let area: string | null = "yard";
  const signs: string[] = [];
  const amygdala = playerAmygdala({
    bot: { entities: {}, registry: { entitiesByName: {}, foodsByName: {} } },
    store: createAssociations(held),
    innateThreats: "game",
    innateHurts: ["lava"],
    innateBadFoods: ["rotten_flesh"],
    gut: { lastMeal: () => null, knowsBad: (food) => food === "old_rule_food" },
    pain: { knows: (block) => block === "old_rule_block" },
    threats: { isThreat: () => false, danger: () => 0.5, shoots: () => false },
    memory: { signs: () => signs },
    hostile: () => false,
    area: () => area,
    neverHurts: (block) => block === "chest",
    ...over,
  });
  return { amygdala, signs, go: (to: string | null) => void (area = to) };
}

describe("what the amygdala's readers are handed", () => {
  it("a block is known to hurt, and a food to be bad, once it predicts enough harm here; found safe here, it is not, and elsewhere it is again", () => {
    const { amygdala, go } = wired({ "block:thorn": of(0.4, { yard: 0.9 }), "block:moss": of(0.05), "food:toadstool": of(0.5), "food:bread": of(0) });
    expect(amygdala.knowsHurt("thorn")).toBe(false);
    go("cave");
    expect(amygdala.knowsHurt("thorn")).toBe(true);
    expect(amygdala.knowsHurt("moss")).toBe(false);
    expect(amygdala.knowsBadFood("toadstool")).toBe(true);
    expect(amygdala.knowsBadFood("bread")).toBe(false);
  });

  it("the inborn hurts stay fixed whatever is learned (the hard reflexes stand on them), and the base's own blocks never hurt", () => {
    const { amygdala } = wired({ "block:lava": of(0.8, { yard: 1 }), "block:chest": of(0.9) });
    expect(amygdala.knowsHurt("lava")).toBe(true);
    expect(amygdala.knowsHurt("chest")).toBe(false);
  });

  it("with a reader at 0 the old rule answers", () => {
    const { amygdala } = wired({ "block:thorn": of(0.9), "food:toadstool": of(0.9) }, { settings: { ...DEFAULT_AMYGDALA, readers: NO_READERS } });
    expect([amygdala.knowsHurt("thorn"), amygdala.knowsHurt("old_rule_block")]).toEqual([false, true]);
    expect([amygdala.knowsBadFood("toadstool"), amygdala.knowsBadFood("old_rule_food")]).toEqual([false, true]);
    expect(amygdala.fear.strength).toBe(0);
    expect(amygdala.dread).toBeUndefined();
    expect(amygdala.fearOfThing("wolf", "entity:1")).toBe(0);
  });

  it("gives the threat sense a kind's harm here, and the thalamus how feared a thing is", () => {
    const { amygdala, go } = wired({ "kind:wolf": of(0.6, { yard: 0.5 }) });
    expect(amygdala.fear.harmOf("wolf", Date.now())).toBeCloseTo(0.3, 1);
    go("cave");
    expect(amygdala.fear.harmOf("wolf", Date.now())).toBeCloseTo(0.5, 1);
    expect(amygdala.fearOfThing("wolf", "entity:1")).toBeCloseTo(0.5, 1);
    expect(amygdala.fear.harmOf("cow", Date.now())).toBe(0);
  });

  it("a kind the amygdala has not met yet is rated as it would begin: by what it is born with, else by what is known of similar kinds", () => {
    const registry = { entitiesByName: { zombie: { height: 1.95, width: 0.6, type: "hostile" }, husk: { height: 1.95, width: 0.6, type: "hostile" }, chicken: { height: 0.7, width: 0.4, type: "animal" } }, foodsByName: {} };
    const hostile = (kind: string) => kind !== "chicken";
    expect(wired({}, { hostile }).amygdala.fear.harmOf("zombie", Date.now())).toBe(0.5);
    const { amygdala } = wired({ "kind:husk": of(0.8) }, { hostile, innateThreats: [], bot: { entities: {}, registry } });
    expect(amygdala.fear.harmOf("zombie", Date.now())).toBeCloseTo(0.4);
    expect(amygdala.fear.harmOf("chicken", Date.now())).toBeLessThan(0.1);
    expect(amygdala.knowsBadFood("rotten_flesh")).toBe(true);
  });

  it("dread: a feared place, or a sign of harm happening now, with nothing needing to be in view", () => {
    const { amygdala, signs, go } = wired({ "area:cave": of(0.4), "sign:hiss": of(0.6) });
    expect(amygdala.dread!(Date.now())).toBeNull();
    go("cave");
    expect(amygdala.dread!(Date.now())).toBe("a place it has come to fear");
    signs.push("hiss");
    expect(amygdala.dread!(Date.now())).toBe("a sign of harm (hiss)");
  });
});
