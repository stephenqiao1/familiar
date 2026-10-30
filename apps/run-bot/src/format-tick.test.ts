import { describe, expect, it } from "vitest";
import type { TickLog } from "@familiar/contracts";
import { formatTick } from "./format-tick.js";

const base: TickLog = {
  tick: 3,
  timestamp: 0,
  state: { schemaVersion: 1, tick: 3, timestamp: 0, data: {} },
  questions: [],
  answers: [],
  engineLatencyMs: 0.123,
  action: { skill: "idle" },
};

describe("formatTick", () => {
  it("shows tick, skill and latency", () => {
    expect(formatTick(base)).toBe("tick 3  idle  0.1ms");
  });

  it("shows keep going", () => {
    expect(formatTick({ ...base, action: { keepGoing: true } })).toBe("tick 3  keep going  0.1ms");
  });
});
