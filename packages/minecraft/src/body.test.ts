import { describe, expect, it } from "vitest";
import { airOf, effectsOf, freezingOf, isBurning, resetBody } from "./body.js";

describe("the body's flags", () => {
  it("reads breath from the bot's own entity: 300 ticks is full (20)", () => {
    expect(airOf({ metadata: [0, 300] })).toBe(20);
    expect(airOf({ metadata: [0, 90] })).toBe(6);
    expect(airOf({ metadata: [0, -20] })).toBe(0);
    expect(airOf({})).toBe(20);
  });

  it("is burning when the fire bit of its flags is set", () => {
    expect(isBurning({ metadata: [1] })).toBe(true);
    expect(isBurning({ metadata: [3] })).toBe(true);
    expect(isBurning({ metadata: [2] })).toBe(false);
    expect(isBurning({})).toBe(false);
  });

  it("is reset after a death, so a new body is not still burning or breathless", () => {
    const entity = { metadata: [1, 12] as unknown[] };
    resetBody(entity);
    expect([isBurning(entity), airOf(entity)]).toEqual([false, 20]);
  });
});

describe("status effects and freezing", () => {
  const names = (id: number) => ({ 18: "Poison", 16: "Hunger", 3: "Mining Fatigue" })[id];

  it("names the effects on the body, in lower case", () => {
    expect(effectsOf({ effects: { 18: { id: 18 }, 3: { id: 3 } } }, names).sort()).toEqual(["mining_fatigue", "poison"]);
    expect(effectsOf({}, names)).toEqual([]);
  });

  it("reads how frozen the body is, 0 to 1", () => {
    expect(freezingOf({ metadata: [0, 300, 0, 0, 0, 0, 0, 70] })).toBe(0.5);
    expect(freezingOf({ metadata: [0, 300, 0, 0, 0, 0, 0, 500] })).toBe(1);
    expect(freezingOf({})).toBe(0);
  });

  it("a death clears the effects and the frost: a new body is not still poisoned", () => {
    const entity = { metadata: [1, 12, 0, 0, 0, 0, 0, 140] as unknown[], effects: { 18: { id: 18 } } as Record<string, unknown> };
    resetBody(entity);
    expect([effectsOf(entity, names), freezingOf(entity), isBurning(entity), airOf(entity)]).toEqual([[], 0, false, 20]);
  });
});
