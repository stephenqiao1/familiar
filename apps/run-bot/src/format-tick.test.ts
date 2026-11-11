import { describe, expect, it } from "vitest";
import type { TickLog } from "@familiar/contracts";
import { formatTick } from "./format-tick.js";

const base: TickLog = {
  tick: 3,
  timestamp: 0,
  state: { schemaVersion: 2, tick: 3, timestamp: 0, data: {} },
  encodeMs: 1,
  decideMs: 184.4,
  regions: [],
  winner: null,
  action: { keepGoing: true },
  goal: null,
  signals: {},
};

describe("formatTick", () => {
  it("shows the action, the winning region and skill events", () => {
    const entry: TickLog = {
      ...base,
      action: { skill: "attack", target: "entity:42" },
      winner: { region: "reflex", layer: 0, urgency: 1, reason: "zombie 4 blocks away", action: { skill: "attack", target: "entity:42" } },
      skillEvents: [
        { skill: "idle", type: "interrupted", timestamp: 0 },
        { skill: "attack", target: "entity:42", type: "started", timestamp: 0 },
      ],
    };
    expect(formatTick(entry)).toBe(
      'tick 3  attack (entity:42) <- reflex 1.00 "zombie 4 blocks away"  184ms  | idle interrupted, attack (entity:42) started',
    );
  });

  it("shows signals, a newly arrived goal, and region errors", () => {
    const entry: TickLog = {
      ...base,
      signals: { in_danger: { value: 0.812, source: "instinct", at: 0 } },
      goal: { text: "find iron", steps: [], reason: "", setBy: "neocortex", setAt: 0 },
      regions: [
        { region: "instinct", layer: 1, ms: 1500, proposals: [], error: "timed out after 1500 ms" },
        { region: "neocortex", layer: 2, background: true, ms: 4000, proposals: [] },
      ],
    };
    expect(formatTick(entry)).toBe('tick 3  keep going  184ms  in_danger=0.81  new goal="find iron"  ! instinct: timed out after 1500 ms');
  });

  it("shows failure reasons", () => {
    const entry: TickLog = { ...base, skillEvents: [{ skill: "eat", type: "failed", reason: "cannot run", timestamp: 0 }] };
    expect(formatTick(entry)).toBe("tick 3  keep going  184ms  | eat failed (cannot run)");
  });
});
