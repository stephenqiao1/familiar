import { describe, expect, it } from "vitest";
import { aimAt, cueProposals, MAX_CUE_URGENCY, type Thing } from "./cues.js";
import { createScorebook, type Scorebook } from "./scorebook.js";
import { reliefOf } from "./wanting.js";

const chest = (id: string): Thing => ({ id, kind: "chest", fixed: true });
const cow = (id: string): Thing => ({ id, kind: "cow" });
const lava: Thing = { id: "pos:0,0,9", kind: "lava", fixed: true };
const NEAR = chest("pos:1,0,0");
const FAR = chest("pos:5,0,0");
const FOOD = reliefOf("go_to", "food_stock");
const HEALTH = reliefOf("go_to", "health");

/** Teaches that a trip to `thing` brought the need down by `relief`, `times` over. */
function relieved(scorebook: Scorebook, thing: Thing, relief: number, times = 12, key = FOOD, situation = "day") {
  for (let i = 0; i < times; i++) scorebook.learn(situation, key, relief, 0.1, aimAt(thing));
  return scorebook;
}
/** A scorebook where trips to the near chest brought the food stock up half way. */
const book = () => relieved(createScorebook(), NEAR, 0.5);
const SHORT = { food_stock: 1, health: 0 };
const run = (things: Thing[], scorebook = book(), needs: Record<string, number> = SHORT, situation = "day", skillsToward: () => string[] = () => ["go_to"]) =>
  cueProposals({ things, situation, da: 0.5, needs, scorebook, skillsToward });

describe("aimAt", () => {
  it("files a thing that stays put under its own id, and one that moves under its kind alone", () => {
    expect(aimAt(NEAR)).toEqual({ kind: "chest", id: "pos:1,0,0" });
    expect(aimAt(cow("entity:7"))).toEqual({ kind: "cow" });
  });
});

describe("cueProposals", () => {
  it("proposes heading to a thing that relieved a need now pressing", () => {
    const { cues, proposals } = run([NEAR, lava]);
    expect(cues).toEqual([{ thing: NEAR, skill: "go_to", want: expect.any(Number), needs: { food_stock: expect.any(Number) } }]);
    expect(proposals).toEqual([{ action: { skill: "go_to", target: "pos:1,0,0" }, urgency: expect.any(Number), reason: expect.stringMatching(/^wants the chest \(food_stock 0\.\d\d\)/) }]);
    expect(proposals[0]!.urgency).toBeCloseTo(cues[0]!.want);
  });

  it("wants it as much as the need presses: a lot with nothing left, less when nearly stocked, not at all with enough", () => {
    const want = (level: number) => run([NEAR], book(), { food_stock: level }).cues[0]?.want ?? 0;
    expect(want(1)).toBeGreaterThan(0.5);
    expect(want(0.25)).toBeGreaterThan(0);
    expect(want(0.25)).toBeLessThan(0.1);
    expect(want(0)).toBe(0);
    // Strong enough, with nothing left, to beat a pick at 0.8; never a hard reflex.
    expect(run([NEAR], relieved(createScorebook(), NEAR, 1, 40)).proposals[0]!.urgency).toBeGreaterThan(0.8);
  });

  it("pays for each need by itself, and a need that going there makes worse counts against", () => {
    const scorebook = relieved(book(), NEAR, -0.4, 12, HEALTH);
    const { cues } = run([NEAR], scorebook);
    expect(cues[0]!.needs.health).toBeLessThan(0);
    expect(cues[0]!.want).toBeLessThan(run([NEAR]).cues[0]!.want);
    // Harm enough, and it is not wanted at all.
    expect(run([NEAR], relieved(book(), NEAR, -1, 40, HEALTH), { food_stock: 0.5, health: 0 }).proposals).toEqual([]);
  });

  it("wants a chest it has never visited a little, from what chests have given", () => {
    const { cues } = run([FAR]);
    expect(cues).toHaveLength(1);
    expect(cues[0]!.want).toBeLessThan(run([NEAR]).cues[0]!.want);
  });

  it("of two chests in view, wants the one that gave, not the nearest", () => {
    const scorebook = createScorebook();
    for (let i = 0; i < 12; i++) {
      scorebook.learn("day", FOOD, 0.5, 0.1, aimAt(FAR));
      scorebook.learn("day", FOOD, 0, 0.1, aimAt(NEAR));
    }
    expect(run([NEAR, FAR], scorebook).proposals).toMatchObject([{ action: { skill: "go_to", target: FAR.id } }]);
    // With only the empty one in view it wants nothing.
    expect(run([NEAR], scorebook).proposals).toEqual([]);
  });

  it("takes the nearest of two things it knows nothing to tell apart", () => {
    const scorebook = relieved(createScorebook(), cow("entity:1"), 0.5, 3);
    expect(run([cow("entity:8"), cow("entity:9")], scorebook).proposals).toMatchObject([{ action: { target: "entity:8" } }]);
  });

  it("still wants it in another situation, until that situation proves different", () => {
    const scorebook = book();
    expect(run([NEAR], scorebook, SHORT, "night").proposals).toHaveLength(1);
    relieved(scorebook, FAR, -0.5, 30, FOOD, "night");
    expect(run([NEAR], scorebook, SHORT, "night").proposals).toEqual([]);
  });

  it("does not want everything a skill can reach because the skill pays in general", () => {
    // Walking has relieved the need with no aim at all: nothing is known about cows.
    const scorebook = createScorebook();
    for (let i = 0; i < 12; i++) scorebook.learn("day", FOOD, 0.5, 0.1);
    expect(run([cow("entity:1")], scorebook).proposals).toEqual([]);
  });

  it("wants nothing where aiming there has cost more than it would pay now (a death)", () => {
    const scorebook = book();
    scorebook.learn("day", "go_to", -5, 0.1, aimAt(NEAR));
    expect(run([NEAR], scorebook).proposals).toEqual([]);
  });

  it("wants nothing it never learned about, nothing no skill can reach, and nothing at strength 0", () => {
    expect(run([NEAR], createScorebook()).proposals).toEqual([]);
    expect(run([NEAR], book(), SHORT, "day", () => []).proposals).toEqual([]);
    expect(cueProposals({ things: [NEAR], situation: "day", da: 0.5, needs: SHORT, scorebook: book(), skillsToward: () => ["go_to"], strength: 0 }).proposals).toEqual([]);
  });

  it("wants more with high DA and less with low, and caps the urgency", () => {
    const at = (da: number) => cueProposals({ things: [NEAR], situation: "day", da, needs: { food_stock: 0.5 }, scorebook: book(), skillsToward: () => ["go_to"] }).proposals[0]!.urgency;
    expect(at(0.7)).toBeGreaterThan(at(0.5));
    expect(at(0.3)).toBeLessThan(at(0.5));
    const sure = relieved(createScorebook(), NEAR, 1, 60);
    expect(cueProposals({ things: [NEAR], situation: "day", da: 0.9, needs: SHORT, scorebook: sure, skillsToward: () => ["go_to"] }).proposals[0]!.urgency).toBe(MAX_CUE_URGENCY);
  });

  it("wants a remembered thing less by the extra walk: still with nothing left, not when only a little short", () => {
    const far = { ...NEAR, extraWork: 0.3 };
    expect(run([far]).cues[0]!.want).toBeCloseTo(run([NEAR]).cues[0]!.want - 0.3);
    expect(run([NEAR], book(), { food_stock: 0.4 }).proposals).toHaveLength(1);
    expect(run([far], book(), { food_stock: 0.4 }).proposals).toEqual([]);
  });
});
