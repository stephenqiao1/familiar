import { describe, expect, it } from "vitest";
import { DEFAULT_DEFENCE, defenceProblem } from "./settings.js";
import { createThreatRecord, MIDDLING } from "./threat-record.js";

const record = (over = {}) => createThreatRecord({ ...DEFAULT_DEFENCE, ...over });

describe("createThreatRecord", () => {
  it("a kind never met has a middling danger; the game's hostile flag makes a threat by default", () => {
    const r = record();
    expect(r.danger("zombie")).toBe(MIDDLING);
    expect(r.isThreat("zombie", true)).toBe(true);
    expect(r.isThreat("cow", false)).toBe(false);
  });
  it("danger rises with damage and with deaths", () => {
    const r = record();
    r.hurtBy("zombie", 3, 2, true, 0);
    const afterHit = r.danger("zombie");
    expect(afterHit).toBeGreaterThan(MIDDLING);
    r.hurtBy("zombie", 10, 2, true, 1000);
    expect(r.danger("zombie")).toBeGreaterThan(afterHit + 0.05);
    const before = r.danger("zombie");
    r.diedTo("zombie");
    expect(r.danger("zombie")).toBeGreaterThan(before + 0.1);
    expect(r.justLearned().some((n) => n.startsWith("zombie became dangerous"))).toBe(true);
  });
  it("many harmless encounters: danger falls, slowly", () => {
    const r = record();
    r.parted("zombie", 0, false);
    expect(r.danger("zombie")).toBeGreaterThan(0.45);
    for (let i = 0; i < 40; i++) r.parted("zombie", 0, false);
    expect(r.danger("zombie")).toBeLessThan(0.2);
    expect(r.danger("zombie")).toBeGreaterThanOrEqual(0.1);
  });
  it("two hits from range: it shoots; hits from close do not count", () => {
    const r = record();
    r.hurtBy("skeleton", 3, 12, true, 0);
    expect(r.shoots("skeleton")).toBe(false);
    r.hurtBy("skeleton", 3, 2, true, 1000);
    expect(r.shoots("skeleton")).toBe(false);
    r.hurtBy("skeleton", 3, 9, true, 2000);
    expect(r.shoots("skeleton")).toBe(true);
    expect(r.justLearned()).toContain("skeleton was found to shoot (hurt from afar 2 times)");
  });
  it("beatable: on from the start for an ordinary kind, off after a loss, on again once kills outnumber losses", () => {
    const r = record();
    expect(r.beatable("zombie")).toBe(true);
    r.diedTo("zombie");
    expect(r.beatable("zombie")).toBe(false);
    r.killed("zombie");
    expect(r.beatable("zombie")).toBe(true);
    r.parted("zombie", 12, false);
    expect(r.beatable("zombie")).toBe(false);
    expect(r.justLearned().filter((n) => n.includes("beatable"))).toHaveLength(3);
  });
  it("a kind born never-to-fight becomes beatable only after beating it several times", () => {
    const r = record();
    expect(r.beatable("creeper")).toBe(false);
    r.killed("creeper");
    r.killed("creeper");
    expect(r.beatable("creeper")).toBe(false);
    r.killed("creeper");
    expect(r.beatable("creeper")).toBe(true);
  });
  it("something the game does not flag hostile becomes a threat once it hurts the bot, and is let go if harmless long enough", () => {
    const r = record();
    r.hurtBy("wolf", 4, 2, false, 0);
    expect(r.isThreat("wolf", false)).toBe(true);
    expect(r.justLearned()).toContain("wolf became a threat (it hurt the bot)");
    for (let i = 0; i < 60; i++) r.parted("wolf", 0, false);
    expect(r.isThreat("wolf", false)).toBe(false);
  });
  it("another player needs two hits a few seconds apart, never one", () => {
    const r = record();
    r.hurtBy("player:Sam", 5, 2, false, 0);
    expect(r.isThreat("player:Sam", false)).toBe(false);
    r.hurtBy("player:Sam", 5, 2, false, 500);
    expect(r.isThreat("player:Sam", false)).toBe(false);
    r.hurtBy("player:Sam", 5, 2, false, 4000);
    expect(r.isThreat("player:Sam", false)).toBe(true);
    // Two hits minutes apart are two accidents.
    const other = record();
    other.hurtBy("player:Kim", 5, 2, false, 0);
    other.hurtBy("player:Kim", 5, 2, false, 120_000);
    expect(other.isThreat("player:Kim", false)).toBe(false);
  });
  it("empty innate lists: nothing is a threat until it hurts the bot, and nothing is born unbeatable", () => {
    const r = record({ innateThreats: [], innateNeverFight: [] });
    expect(r.isThreat("zombie", true)).toBe(false);
    expect(r.beatable("creeper")).toBe(true);
    r.hurtBy("zombie", 3, 2, true, 0);
    expect(r.isThreat("zombie", true)).toBe(true);
  });
  it("with learning off nothing changes; what was saved is kept", () => {
    const r = createThreatRecord({ ...DEFAULT_DEFENCE, learnThreats: 0 }, { skeleton: { seen: 4, hurts: 2, damage: 6, kills: 0, deaths: 0, badLosses: 0, rangedHurts: 2, danger: 0.8 } });
    r.hurtBy("zombie", 20, 2, true, 0);
    expect(r.danger("zombie")).toBe(MIDDLING);
    expect(r.shoots("skeleton")).toBe(true);
    expect(r.entries()).toHaveProperty("skeleton");
  });
});

describe("defenceProblem", () => {
  it("accepts the defaults and rejects bad values", () => {
    expect(defenceProblem(DEFAULT_DEFENCE)).toBeNull();
    expect(defenceProblem({ ...DEFAULT_DEFENCE, freeze: 2 })).toContain("defence.freeze");
    expect(defenceProblem({ ...DEFAULT_DEFENCE, innateThreats: "all" as never })).toContain("innateThreats");
    expect(defenceProblem({ ...DEFAULT_DEFENCE, innateNeverFight: [3] as never })).toContain("innateNeverFight");
  });
});
