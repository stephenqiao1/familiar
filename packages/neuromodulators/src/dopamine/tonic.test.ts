import { describe, expect, it } from "vitest";
import { createTonicDopamine, DA_FLOOR, RESTING_DA } from "./tonic.js";

describe("createTonicDopamine", () => {
  it("rests at 0.5 with no reward", () => {
    expect(createTonicDopamine().update(0, 0)).toBe(RESTING_DA);
  });

  it("rests at a personality's own level, and drifts back to it", () => {
    const eager = createTonicDopamine(0.65);
    expect(eager.update(0, 0)).toBeCloseTo(0.65);
    expect(eager.update(1, 0)).toBeGreaterThan(0.7);
    expect(eager.update(0, 3_600_000)).toBeCloseTo(0.65);
  });

  it("rises with good rewards and falls with bad ones", () => {
    expect(createTonicDopamine().update(1, 0)).toBeCloseTo(0.62);
    expect(createTonicDopamine().update(-1, 0)).toBeCloseTo(0.38);
  });

  it("never drops below the floor, and drifts back to rest from it", () => {
    const da = createTonicDopamine();
    expect(da.update(-10, 0)).toBe(DA_FLOOR);
    expect(da.update(0, 3_600_000)).toBeCloseTo(RESTING_DA);
  });

  it("leaves room at the top: several rewards in a few minutes do not pin it to the ceiling", () => {
    const da = createTonicDopamine();
    let level = 0;
    for (let minute = 0; minute < 5; minute++) level = da.update(1, minute * 60_000);
    expect(level).toBeGreaterThan(0.75);
    expect(level).toBeLessThan(0.9);
  });

  it("drifts back to rest as rewards fade over minutes", () => {
    const da = createTonicDopamine();
    da.update(1, 0);
    expect(da.update(0, 180_000)).toBeCloseTo(1 / (1 + Math.exp(-0.5 / Math.E)));
    expect(da.update(0, 3_600_000)).toBeCloseTo(RESTING_DA);
  });

  it("adds up rewards that come close together", () => {
    const da = createTonicDopamine();
    da.update(0.5, 0);
    expect(da.update(0.5, 0)).toBeCloseTo(0.62);
  });
});
