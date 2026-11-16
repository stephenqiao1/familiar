import { describe, expect, it } from "vitest";
import { createPain, likelyCauses, type Hurt, type Touching } from "./pain.js";

const touching = (over: Partial<Touching> = {}): Touching => ({ feet: "air", head: "air", below: "sand", sides: ["cactus", "air", "air", "air"], ...over });
const hurt = (over: Partial<Hurt> = {}): Hurt => ({ at: 0, by: null, kind: "cactus", where: { x: 0, y: 63, z: 0 }, touching: touching(), ...over });
const INNATE = ["lava", "fire", "soul_fire"];

describe("likelyCauses", () => {
  it("blames the block the game names, when the body is touching one", () => {
    expect(likelyCauses(hurt())).toEqual(["cactus"]);
    expect(likelyCauses(hurt({ kind: "sweet_berry_bush", touching: touching({ feet: "sweet_berry_bush", sides: ["air", "air", "air", "air"] }) }))).toEqual(["sweet_berry_bush"]);
  });

  it("for a hot floor, blames what is under the feet", () => {
    expect(likelyCauses(hurt({ kind: "hot_floor", touching: touching({ below: "magma_block" }) }))).toEqual(["magma_block"]);
  });

  it("otherwise blames everything the body is touching", () => {
    expect(likelyCauses(hurt({ kind: null }))).toEqual(["air", "sand", "cactus"]);
  });
});

describe("createPain", () => {
  it("knows what it was born knowing, and nothing else", () => {
    const pain = createPain({ innate: INNATE });
    expect([pain.knows("lava"), pain.knows("cactus"), pain.knows("magma_block")]).toEqual([true, false, false]);
  });

  it("one incident is not enough; two separate incidents make a block known to hurt", () => {
    const pain = createPain({ innate: INNATE });
    expect(pain.withdrew(hurt(), 0)).toMatchObject({ causes: ["cactus"], learned: [] });
    expect(pain.knows("cactus")).toBe(false);
    expect(pain.withdrew(hurt(), 5000)).toMatchObject({ causes: ["cactus"], learned: ["cactus"] });
    expect(pain.knows("cactus")).toBe(true);
    expect(pain.entries()).toEqual({ cactus: 2 });
    expect(pain.justLearned()).toEqual(["cactus"]);
    expect(pain.justLearned()).toEqual([]);
    // Already known: nothing more to learn.
    expect(pain.withdrew(hurt(), 20_000).learned).toEqual([]);
  });

  it("one burst of damage counts once: incidents must be at least 2 seconds apart", () => {
    const pain = createPain({ innate: INNATE });
    for (const at of [0, 500, 1000, 1500]) pain.withdrew(hurt(), at);
    expect(pain.knows("cactus")).toBe(false);
    pain.withdrew(hurt(), 3600);
    expect(pain.knows("cactus")).toBe(true);
  });

  it("never learns from an attack: a zombie hitting the bot on grass does not teach that grass hurts", () => {
    const pain = createPain({ innate: INNATE });
    const struck = hurt({ by: "entity:9", kind: "mob_attack", touching: touching({ below: "grass_block", sides: ["air", "air", "air", "air"] }) });
    for (const at of [0, 5000, 10_000]) expect(pain.withdrew(struck, at)).toMatchObject({ causes: [], learned: [] });
    expect(pain.knows("grass_block")).toBe(false);
    expect(pain.entries()).toEqual({});
  });

  it("never learns air, water or the base's own blocks, and says when the evidence pointed there", () => {
    const pain = createPain({ innate: INNATE, neverLearn: (name) => name === "chest" });
    const unknown = hurt({ kind: null, touching: { feet: "water", head: "air", below: "chest", sides: ["air", "air", "air", "air"] } });
    for (const at of [0, 5000]) expect(pain.withdrew(unknown, at)).toMatchObject({ causes: [], refused: ["chest"], learned: [] });
    expect([pain.knows("air"), pain.knows("water"), pain.knows("chest")]).toEqual([false, false, false]);
  });

  it("starts from what was learned before, and learns nothing with learning off", () => {
    expect(createPain({ innate: INNATE, learned: { cactus: 2, magma_block: 1 } }).knows("cactus")).toBe(true);
    const off = createPain({ innate: INNATE, learnHurts: 0 });
    for (const at of [0, 5000, 10_000]) off.withdrew(hurt(), at);
    expect(off.knows("cactus")).toBe(false);
  });

  it("pulls back 2 blocks, then 4, then 6 if hurt again at the same place soon after", () => {
    const pain = createPain({ innate: INNATE });
    expect([0, 3000, 6000, 9000].map((at) => pain.withdrew(hurt(), at).radius)).toEqual([2, 4, 6, 6]);
    // Somewhere else, or much later, starts again at 2.
    expect(pain.withdrew(hurt({ where: { x: 40, y: 63, z: 0 } }), 10_000).radius).toBe(2);
    expect(pain.withdrew(hurt({ where: { x: 40, y: 63, z: 0 } }), 60_000).radius).toBe(2);
  });

  it("is sore after a withdrawal, fading to nothing over 30 seconds; never with sensitising off", () => {
    const pain = createPain({ innate: INNATE });
    expect(pain.sore(0)).toBe(0);
    pain.withdrew(hurt(), 1000);
    expect([pain.sore(1000), pain.sore(16_000), pain.sore(31_000), pain.sore(60_000)]).toEqual([1, 0.5, 0, 0]);
    const numb = createPain({ innate: INNATE, sensitise: 0 });
    numb.withdrew(hurt(), 1000);
    expect(numb.sore(1000)).toBe(0);
  });
});
