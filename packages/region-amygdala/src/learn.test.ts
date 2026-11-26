import { describe, expect, it } from "vitest";
import { createAssociations, harmOf, goodOf, LIMITS, safeHere, type Association } from "./association.js";
import { learnHarmless, learnOutcome, predict, type CueNow, type Moment, type Outcome } from "./learn.js";
import { createPresence } from "./presence.js";
import { DEFAULT_AMYGDALA } from "./settings.js";
import { startOf } from "./spread.js";

const at = (now: number, area: string | null = "field", settings = DEFAULT_AMYGDALA): Moment => ({ area, now, settings });
const cue = (key: string, salience = 1, through?: string): CueNow => ({ key, salience, ...(through ? { through } : {}) });
const hurt = (size: number, extra: Partial<Outcome> = {}): Outcome => ({ sign: "harm", size, what: "hurt", ...extra });
const known = (harm: number, extra: Partial<Association> = {}): Association => ({ harm, good: 0, sure: 1, at: 0, ...extra });

describe("learning by surprise", () => {
  it("learns that a cue predicts harm, and less each time as it comes to be expected", () => {
    const store = createAssociations();
    const steps: number[] = [];
    for (let i = 0; i < 6; i++) {
      const before = store.get("kind:wolf")?.harm ?? 0;
      learnOutcome(store, [cue("kind:wolf")], hurt(0.5), at(i * 1000));
      steps.push(store.get("kind:wolf")!.harm - before);
    }
    expect(steps[0]).toBeGreaterThan(steps[5]!);
    expect(harmOf(store.get("kind:wolf"), "field", 6000)).toBeGreaterThan(0.3);
    expect(harmOf(store.get("kind:wolf"), "field", 6000)).toBeLessThan(0.6);
  });

  it("a bigger outcome teaches faster, and death teaches in one go", () => {
    const [small, big, dead] = [createAssociations(), createAssociations(), createAssociations()];
    learnOutcome(small, [cue("kind:wolf")], hurt(0.2), at(0));
    learnOutcome(big, [cue("kind:wolf")], hurt(0.8), at(0));
    learnOutcome(dead, [cue("kind:wolf")], hurt(1, { final: true }), at(0));
    expect(big.get("kind:wolf")!.harm / 0.8).toBeGreaterThan(small.get("kind:wolf")!.harm / 0.2);
    expect(dead.get("kind:wolf")!.harm).toBe(1);
  });

  it("does not blame a tag-along: what was already predicted is not learned again", () => {
    const store = createAssociations({ "kind:wolf": known(0.6) });
    learnOutcome(store, [cue("kind:wolf"), cue("kind:crow")], hurt(0.6), at(0));
    expect(store.get("kind:crow")!.harm).toBeCloseTo(0, 5);
    // With sharing off, the tag-along is blamed on its own.
    const alone = createAssociations({ "kind:wolf": known(0.6) });
    learnOutcome(alone, [cue("kind:wolf"), cue("kind:crow")], hurt(0.6), at(0, "field", { ...DEFAULT_AMYGDALA, surprise: 0 }));
    expect(alone.get("kind:crow")!.harm).toBeGreaterThan(0.1);
  });

  it("shares blame by how much each cue stands out, and most to what the event points at", () => {
    const store = createAssociations();
    learnOutcome(store, [cue("kind:wolf", 1), cue("time:night", 0.1)], hurt(0.5), at(0));
    expect(store.get("kind:wolf")!.harm).toBeGreaterThan(store.get("time:night")!.harm * 5);
    const pointed = createAssociations();
    learnOutcome(pointed, [cue("kind:wolf", 0.3), cue("kind:crow", 0.3)], hurt(0.5, { points: ["kind:crow"] }), at(0));
    expect(pointed.get("kind:crow")!.harm).toBeGreaterThan(pointed.get("kind:wolf")!.harm * 5);
  });

  it("learns nothing with learning off, even from death", () => {
    const store = createAssociations();
    learnOutcome(store, [cue("kind:wolf")], hurt(1, { final: true }), at(0, "field", { ...DEFAULT_AMYGDALA, learn: 0 }));
    expect(store.get("kind:wolf")).toBeUndefined();
  });

  it("learns good from a need dropping, and lets it fade a little when nothing good follows", () => {
    const store = createAssociations();
    for (let i = 0; i < 5; i++) learnOutcome(store, [cue("kind:chest")], { sign: "good", size: 0.4, what: "hunger eased" }, at(i));
    const learned = goodOf(store.get("kind:chest"), 5);
    expect(learned).toBeGreaterThan(0.2);
    learnHarmless(store, { key: "kind:chest", ms: 30_000, salience: 1 }, [], at(10));
    expect(goodOf(store.get("kind:chest"), 10)).toBeLessThan(learned);
    expect(goodOf(store.get("kind:chest"), 10)).toBeGreaterThan(learned * 0.9);
  });

  it("blames a food only for what came through the gut", () => {
    const store = createAssociations();
    learnOutcome(store, [cue("food:stew", 0.8, "gut"), cue("kind:wolf")], hurt(0.5), at(0));
    expect(store.get("food:stew")).toBeUndefined();
    learnOutcome(store, [cue("food:stew", 0.8, "gut")], hurt(0.3, { through: "gut" }), at(1));
    expect(store.get("food:stew")!.harm).toBeGreaterThan(0);
  });
});

describe("unlearning by place", () => {
  it("never lowers the harm itself: it becomes safe here, and stays feared elsewhere", () => {
    const store = createAssociations({ "kind:wolf": known(0.8) });
    for (let i = 0; i < 30; i++) learnHarmless(store, { key: "kind:wolf", ms: 30_000, salience: 1 }, [], at(i * 1000, "yard"));
    const a = store.get("kind:wolf")!;
    expect(a.harm).toBe(0.8);
    expect(harmOf(a, "yard", 30_000)).toBeLessThan(0.1);
    // Elsewhere a "safe" from another area counts a third.
    expect(harmOf(a, "cave", 30_000)).toBeCloseTo(0.8 * (1 - safeHere(a, "yard", 30_000) / 3), 2);
    expect(harmOf(a, "cave", 30_000)).toBeGreaterThan(0.5);
  });

  it("the fear comes back as 'safe here' fades over a few game days", () => {
    const store = createAssociations({ "kind:wolf": known(0.8, { safe: { yard: { value: 1, at: 0 } } }) });
    const a = store.get("kind:wolf")!;
    expect(harmOf({ ...a, at: LIMITS.safeHalfLifeMs * 3 }, "yard", LIMITS.safeHalfLifeMs * 3)).toBeGreaterThan(0.6);
  });

  it("the fear comes back at once if it hurts here again", () => {
    const store = createAssociations({ "kind:wolf": known(0.8, { safe: { yard: { value: 0.9, at: 0 } } }) });
    const before = harmOf(store.get("kind:wolf"), "yard", 0);
    learnOutcome(store, [cue("kind:wolf")], hurt(0.8), at(0, "yard"));
    expect(harmOf(store.get("kind:wolf"), "yard", 0)).toBeGreaterThan(before * 3);
  });

  it("a hurt smaller than was feared does not make the thing safer", () => {
    const store = createAssociations({ "kind:wolf": known(0.8) });
    learnOutcome(store, [cue("kind:wolf")], hurt(0.1), at(0, "yard"));
    expect(harmOf(store.get("kind:wolf"), "yard", 0)).toBeCloseTo(0.8, 5);
  });

  it("with 'safe here' off, a fear is never let go", () => {
    const store = createAssociations({ "kind:wolf": known(0.8) });
    for (let i = 0; i < 30; i++) learnHarmless(store, { key: "kind:wolf", ms: 30_000, salience: 1 }, [], at(i, "yard", { ...DEFAULT_AMYGDALA, safeHere: 0 }));
    expect(harmOf(store.get("kind:wolf"), "yard", 30, 0)).toBeCloseTo(0.8, 4);
  });

  it("a short meeting counts for less than a long one", () => {
    const [brief, long] = [createAssociations({ "kind:wolf": known(0.8) }), createAssociations({ "kind:wolf": known(0.8) })];
    learnHarmless(brief, { key: "kind:wolf", ms: 2000, salience: 1 }, [], at(0));
    learnHarmless(long, { key: "kind:wolf", ms: 30_000, salience: 1 }, [], at(0));
    expect(safeHere(brief.get("kind:wolf")!, "field", 0)).toBeLessThan(safeHere(long.get("kind:wolf")!, "field", 0));
  });
});

describe("signs of safety", () => {
  it("a cue reliably around with no harm in a dangerous place goes below zero, to -0.5 at most", () => {
    const store = createAssociations({ "area:cave": known(0.8), "kind:torch": known(0) });
    for (let i = 0; i < 400; i++) learnHarmless(store, { key: "kind:torch", ms: 30_000, salience: 1 }, [cue("area:cave"), cue("kind:torch")], at(i, "cave", { ...DEFAULT_AMYGDALA, safeHere: 0 }));
    expect(store.get("kind:torch")!.harm).toBe(LIMITS.safest);
    // It takes away from what the place predicts.
    expect(predict(store, [cue("area:cave"), cue("kind:torch")], "harm", at(400, "cave", { ...DEFAULT_AMYGDALA, safeHere: 0 }))).toBeLessThan(0.5);
  });

  it("a cue that hardly stands out among many gets there slowly", () => {
    const store = createAssociations({ "area:cave": known(0.8), "block:stone": known(0) });
    const around = [cue("area:cave"), cue("kind:bat"), cue("block:stone", 0.15)];
    learnHarmless(store, { key: "block:stone", ms: 30_000, salience: 0.15 }, around, at(0, "cave"));
    expect(store.get("block:stone")!.harm).toBeGreaterThan(-0.01);
    expect(store.get("block:stone")!.harm).toBeLessThan(0);
  });

  it("in a place that is not dangerous, a harmless cue stays at zero", () => {
    const store = createAssociations({ "kind:torch": known(0) });
    learnHarmless(store, { key: "kind:torch", ms: 30_000, salience: 1 }, [cue("kind:torch")], at(0));
    expect(store.get("kind:torch")!.harm).toBe(0);
  });
});

describe("how sure", () => {
  it("sureness fades without evidence, and an unsure association is expressed weakly", () => {
    const store = createAssociations();
    for (let i = 0; i < 10; i++) learnOutcome(store, [cue("kind:wolf")], hurt(0.6), at(i));
    const a = store.get("kind:wolf")!;
    const fresh = harmOf(a, null, 10);
    const stale = harmOf(a, null, 10 + LIMITS.sureHalfLifeMs * 6);
    expect(stale).toBeLessThan(fresh * 0.6);
    expect(stale).toBeGreaterThan(a.harm * LIMITS.unsure * 0.99);
  });

  it("an unsure inborn fear falls back to what it was born with, not to nothing", () => {
    const a: Association = { harm: 0.9, good: 0, sure: 1, at: 0, born: { harm: 0.5, good: 0 } };
    expect(harmOf(a, null, 0)).toBeCloseTo(0.9, 5);
    expect(harmOf(a, null, LIMITS.sureHalfLifeMs * 20)).toBeGreaterThan(0.5);
    expect(harmOf(a, null, LIMITS.sureHalfLifeMs * 20)).toBeLessThan(0.7);
  });
});

describe("spreading", () => {
  const alike = (a: string, b: string) => (a.includes("husk") && b.includes("zombie") ? 0.8 : 0);
  it("a new cue starts with half of a similar cue's harm, times how alike they are", () => {
    const store = createAssociations({ "kind:zombie": known(0.8), "kind:cow": known(0) });
    const start = startOf("kind:husk", undefined, store, alike, 1, 0);
    expect(start.harm).toBeCloseTo(0.5 * 0.8 * 0.8, 5);
    expect(start.from).toBe("kind:zombie");
    expect(startOf("kind:sheep", undefined, store, alike, 1, 0).harm).toBe(0);
  });
  it("starts from nothing with spreading off, and from what it is born with if that is more", () => {
    const store = createAssociations({ "kind:zombie": known(0.8) });
    expect(startOf("kind:husk", undefined, store, alike, 0, 0).harm).toBe(0);
    expect(startOf("kind:husk", { harm: 0.5 }, store, alike, 1, 0).harm).toBe(0.5);
  });
  it("does not spread between types of cue", () => {
    const store = createAssociations({ "kind:zombie": known(0.8) });
    expect(startOf("block:husk", undefined, store, () => 1, 1, 0).harm).toBe(0);
  });
});

describe("who is around", () => {
  it("keeps a cue for a few seconds after it was last offered, a food for a minute", () => {
    const p = createPresence();
    p.note([{ key: "kind:wolf", salience: 1 }, { key: "food:stew", salience: 0.8, through: "gut", lingerMs: 60_000 }], 0);
    expect(p.around(4000).map((c) => c.key)).toEqual(["kind:wolf", "food:stew"]);
    expect(p.around(30_000).map((c) => c.key)).toEqual(["food:stew"]);
    expect(p.around(30_000)[0]!.salience).toBeLessThan(0.8);
    expect(p.around(61_000)).toEqual([]);
  });
  it("a cue that left with no harm was a harmless meeting; harm starts the count again", () => {
    const p = createPresence();
    for (let t = 0; t <= 10_000; t += 1000) p.note([{ key: "kind:wolf", salience: 1 }], t);
    expect(p.harmless(10_000)).toEqual([]);
    expect(p.harmless(16_000)).toEqual([{ key: "kind:wolf", ms: 16_000, salience: 1 }]);
    for (let t = 20_000; t <= 30_000; t += 1000) p.note([{ key: "kind:wolf", salience: 1 }], t);
    p.harmed(30_000);
    expect(p.harmless(36_000)).toEqual([{ key: "kind:wolf", ms: 6000, salience: 1 }]);
  });
  it("a cue that stays is judged once a minute", () => {
    const p = createPresence();
    let meetings = 0;
    for (let t = 0; t <= 180_000; t += 1000) {
      p.note([{ key: "area:yard", salience: 0.2 }], t);
      meetings += p.harmless(t).length;
    }
    expect(meetings).toBe(3);
  });
});

describe("one channel holds one thing at a time", () => {
  it("an illness is blamed on the last thing eaten, not on the meal before it", () => {
    const presence = createPresence();
    const meal = (key: string) => ({ key, salience: 0.8, through: "gut", lingerMs: 60_000 });
    presence.note([meal("food:bread")], 0);
    expect(presence.around(8000).map((c) => c.key)).toEqual(["food:bread"]);
    presence.note([meal("food:toadstool")], 8000);
    expect(presence.around(12_000).map((c) => c.key)).toEqual(["food:toadstool"]);
    // The bread's stay ended with no harm: a harmless meeting.
    expect(presence.harmless(12_000).map((m) => m.key)).toEqual(["food:bread"]);
  });
});

describe("what harms only by contact", () => {
  const floor: CueNow = { key: "block:stone", salience: 0.15, direct: true };
  it("is not blamed for a harm that points elsewhere or at nothing, however bad (the ground does not come to be feared)", () => {
    const store = createAssociations();
    learnOutcome(store, [floor, cue("area:cave", 0.2)], hurt(1, { final: true }), at(0));
    learnOutcome(store, [floor, cue("kind:wolf")], hurt(0.6, { points: ["kind:wolf"] }), at(1000));
    expect(store.get("block:stone")).toBeUndefined();
    expect(store.get("area:cave")!.harm).toBe(1);
  });

  it("is blamed in full when the harm points straight at it", () => {
    const store = createAssociations();
    learnOutcome(store, [{ ...floor, key: "block:thorn" }, cue("area:cave", 0.2)], hurt(0.22, { points: ["block:thorn"] }), at(0));
    learnOutcome(store, [{ ...floor, key: "block:thorn" }, cue("area:cave", 0.2)], hurt(0.22, { points: ["block:thorn"] }), at(1000));
    expect(store.get("block:thorn")!.harm).toBeGreaterThan(0.12);
    expect(store.get("area:cave")!.harm).toBeLessThan(0.02);
  });
});

describe("what is long familiar and harmless is slow to be blamed", () => {
  it("a hurt that points at nothing is blamed on what is new (the cave), not on what has always been there (the ground)", () => {
    const store = createAssociations({ "block:stone": known(0) });
    for (let i = 0; i < 10; i++) learnHarmless(store, { key: "block:stone", ms: 60_000, salience: 0.15 }, [], at(i));
    learnOutcome(store, [cue("block:stone", 0.15), cue("area:cave", 0.2)], hurt(0.8), at(20));
    expect(store.get("area:cave")!.harm).toBeGreaterThan(5 * store.get("block:stone")!.harm);
    expect(store.get("area:cave")!.harm).toBeGreaterThan(0.4);
  });

  it("but a hurt that points straight at the familiar thing is learned in full, and it is familiar no longer", () => {
    const [fresh, familiar] = [createAssociations({ "block:stone": known(0) }), createAssociations({ "block:stone": known(0) })];
    for (let i = 0; i < 10; i++) learnHarmless(familiar, { key: "block:stone", ms: 60_000, salience: 0.15 }, [], at(i));
    for (const store of [fresh, familiar]) learnOutcome(store, [cue("block:stone", 0.15), cue("area:cave", 0.2)], hurt(0.8, { points: ["block:stone"] }), at(20));
    expect(familiar.get("block:stone")!.harm).toBeCloseTo(fresh.get("block:stone")!.harm, 5);
    expect(familiar.get("block:stone")!.met).toBeUndefined();
  });
});

describe("the old rules' weak spots (design problem 7)", () => {
  it("two coincidences do not make a lasting fact: the blame is graded, and let go", () => {
    const store = createAssociations();
    // Twice a small hurt came while standing on gravel (the old rule: gravel hurts, for good).
    for (let i = 0; i < 2; i++) learnOutcome(store, [cue("block:gravel", 0.15), cue("area:hill", 0.2)], hurt(0.1), at(i * 10_000, "hill"));
    expect(harmOf(store.get("block:gravel"), "hill", 20_000)).toBeLessThan(0.1);
    for (let i = 0; i < 40; i++) learnHarmless(store, { key: "block:gravel", ms: 60_000, salience: 1 }, [], at(20_000 + i * 60_000, "hill"));
    expect(harmOf(store.get("block:gravel"), "hill", 2_500_000)).toBeLessThan(0.01);
  });

  it("a food eaten just before a blow is not blamed for the blow", () => {
    const store = createAssociations();
    learnOutcome(store, [cue("food:bread", 0.8, "gut"), cue("kind:zombie")], hurt(0.3, { points: ["kind:zombie"] }), at(0));
    expect(store.get("food:bread")).toBeUndefined();
  });

  it("an illness with something feared in view is mostly not the food's", () => {
    const store = createAssociations({ "kind:witch": known(0.7) });
    learnOutcome(store, [cue("food:bread", 0.8, "gut"), cue("kind:witch")], hurt(0.3, { through: "gut" }), at(0));
    expect(store.get("food:bread")?.harm ?? 0).toBeLessThanOrEqual(0);
  });

  it("a block that hurt is let go where it stops hurting", () => {
    const store = createAssociations();
    for (let i = 0; i < 4; i++) learnOutcome(store, [cue("block:bush", 0.15)], hurt(0.1, { points: ["block:bush"] }), at(i * 5000, "garden"));
    const feared = harmOf(store.get("block:bush"), "garden", 20_000);
    expect(feared).toBeGreaterThan(0.05);
    for (let i = 0; i < 40; i++) learnHarmless(store, { key: "block:bush", ms: 60_000, salience: 1 }, [], at(20_000 + i * 60_000, "garden"));
    expect(harmOf(store.get("block:bush"), "garden", 2_420_000)).toBeLessThan(feared / 5);
  });
});
