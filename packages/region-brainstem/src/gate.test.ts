import { describe, expect, it } from "vitest";
import { createRateGate } from "./gate.js";

describe("createRateGate", () => {
  it("at full rate nothing is held; at rate 0 everything is", () => {
    const gate = createRateGate(500);
    for (let now = 0; now < 2000; now += 150) expect(gate.hold(1, now)).toBe(false);
    for (let now = 2000; now < 4000; now += 500) expect(gate.hold(0, now)).toBe(true);
    expect(gate.counts()).toEqual({ made: 14, saved: 4 });
  });
  it("spaces calls by the rate: at 0.3, one call every interval ÷ 0.3", () => {
    const gate = createRateGate(500);
    const made: number[] = [];
    for (let now = 0; now <= 5000; now += 500) if (!gate.hold(0.3, now)) made.push(now);
    expect(made).toEqual([0, 2000, 4000]);
  });
  it("an urgent call goes through whatever the rate", () => {
    const gate = createRateGate(15_000);
    expect(gate.hold(0.3, 0)).toBe(false);
    expect(gate.hold(0.3, 1000)).toBe(true);
    expect(gate.hold(0.3, 2000, true)).toBe(false);
    expect(gate.hold(0, 3000, true)).toBe(false);
  });
  it("asked twice about the same moment, it gives the same answer and counts once", () => {
    const gate = createRateGate(500);
    expect([gate.hold(0.5, 0), gate.hold(0.5, 0), gate.hold(0.5, 100), gate.hold(0.5, 100)]).toEqual([false, false, true, true]);
    expect(gate.counts()).toEqual({ made: 1, saved: 1 });
  });
});
