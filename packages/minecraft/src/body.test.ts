import { describe, expect, it } from "vitest";
import { airOf, isBurning, resetBody } from "./body.js";

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
