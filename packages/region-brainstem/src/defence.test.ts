import { describe, expect, it } from "vitest";
import { BASE, chooseDefence, flightDistance, mostPressing, type DefenceInputs, type Threat } from "./defence.js";

const threat = (over: Partial<Threat> = {}): Threat => ({ id: "t1", kind: "zombie", dist: 6, stage: "coming", noticed: true, canReach: true, escapable: true, danger: 0.5, beatable: true, flightDistance: 8, ...over });
const choose = (threats: Threat[], over: Partial<DefenceInputs> = {}) => chooseDefence({ threats, possible: null, health: 1, armed: true, travelling: false, ...over });

describe("flightDistance", () => {
  it("is 8 blocks for a middling threat and a middling bot", () => {
    expect(flightDistance(0.5, 0.5)).toBeCloseTo(8);
  });
  it("grows with danger and shrinks with bravery", () => {
    expect(flightDistance(1, 0.5)).toBeGreaterThan(flightDistance(0.5, 0.5));
    expect(flightDistance(0.1, 0.5)).toBeLessThan(flightDistance(0.5, 0.5));
    expect(flightDistance(0.5, 1)).toBeLessThan(flightDistance(0.5, 0.5));
    expect(flightDistance(0.5, 0)).toBeGreaterThan(flightDistance(0.5, 0.5));
    expect(flightDistance(1, 0)).toBeCloseTo(8 * 1.5 * 1.3);
  });
  it("is a flat 8 with the strength at 0", () => {
    expect(flightDistance(1, 0, 0)).toBe(8);
  });
});

describe("chooseDefence", () => {
  it("nothing at all: no mode", () => {
    expect(choose([])).toMatchObject({ mode: "none", threat: 0, base: 0 });
  });
  it("possible danger: wary, no action", () => {
    expect(choose([], { possible: "dark" })).toMatchObject({ mode: "wary", base: 0, threat: 0.3 });
    expect(choose([threat({ stage: "possible" })])).toMatchObject({ mode: "wary", base: 0, threat: 0.3 });
  });
  it("seen and not noticed: freeze at 0.5", () => {
    expect(choose([threat({ stage: "seen", noticed: false, dist: 10 })])).toMatchObject({ mode: "freeze", base: BASE.freeze, threat: 0.5, target: "t1" });
  });
  it("seen and not noticed while travelling: avoid, no action", () => {
    expect(choose([threat({ stage: "seen", noticed: false, dist: 10 })], { travelling: true })).toMatchObject({ mode: "avoid", base: 0 });
  });
  it("seen but far beyond the flight distance, or already noticed: only wary", () => {
    expect(choose([threat({ stage: "seen", noticed: false, dist: 14 })]).mode).toBe("wary");
    expect(choose([threat({ stage: "seen", noticed: true, dist: 12 })]).mode).toBe("wary");
  });
  it("coming with a way out: flee at 0.7", () => {
    expect(choose([threat()])).toMatchObject({ mode: "flee", base: BASE.flee, threat: 0.8, cornered: false });
  });
  it("coming and cornered: freeze at 0.6", () => {
    expect(choose([threat({ escapable: false })])).toMatchObject({ mode: "freeze", base: BASE.corneredFreeze, cornered: true });
  });
  it("on it with a way out, unarmed, weak or unbeatable: break away at 0.9", () => {
    const onIt = threat({ stage: "on_it", dist: 2 });
    expect(choose([onIt], { armed: false })).toMatchObject({ mode: "flee", base: BASE.breakAway, threat: 1 });
    expect(choose([onIt], { health: 0.4 }).mode).toBe("flee");
    expect(choose([{ ...onIt, beatable: false }]).mode).toBe("flee");
  });
  it("on it, armed, healthy and beatable: fight at 0.9", () => {
    expect(choose([threat({ stage: "on_it", dist: 2 })])).toMatchObject({ mode: "fight", base: BASE.fight });
  });
  it("cornered flips flee to fight, even unarmed and weak", () => {
    const onIt = threat({ stage: "on_it", dist: 2, escapable: false });
    expect(choose([onIt], { armed: false, health: 0.2 })).toMatchObject({ mode: "fight", cornered: true });
    expect(choose([{ ...onIt, escapable: true }], { armed: false, health: 0.2 }).mode).toBe("flee");
  });
  it("three coming at once flips fight to flee", () => {
    const onIt = threat({ stage: "on_it", dist: 2 });
    expect(choose([onIt, threat({ id: "t2" })]).mode).toBe("fight");
    expect(choose([onIt, threat({ id: "t2" }), threat({ id: "t3" })])).toMatchObject({ mode: "flee", coming: 3 });
  });
  it("a freeze ends the tick its threat notices and closes", () => {
    const unnoticed = threat({ stage: "seen", noticed: false, dist: 7 });
    expect(choose([unnoticed]).mode).toBe("freeze");
    expect(choose([{ ...unnoticed, stage: "coming", noticed: true }]).mode).toBe("flee");
  });
  it("with freezing off, a seen threat is only watched; with cornered off, it always flees", () => {
    expect(chooseDefence({ threats: [threat({ stage: "seen", noticed: false })], possible: null, health: 1, armed: true, travelling: false }, { freeze: 0, cornered: 1 }).mode).toBe("wary");
    expect(chooseDefence({ threats: [threat({ escapable: false })], possible: null, health: 1, armed: true, travelling: false }, { freeze: 1, cornered: 0 }).mode).toBe("flee");
  });
  it("chooses for the threat furthest along, then the closest", () => {
    expect(mostPressing([threat({ id: "far", stage: "seen", dist: 3 }), threat({ id: "a", dist: 7 }), threat({ id: "b", dist: 5 })])?.id).toBe("b");
  });
});
