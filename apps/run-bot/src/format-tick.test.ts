import { describe, expect, it } from "vitest";
import type { TickLog } from "@familiar/contracts";
import { formatTick } from "./format-tick.js";

const base: TickLog = {
  tick: 3,
  timestamp: 0,
  state: { schemaVersion: 2, tick: 3, timestamp: 0, data: {} },
  questions: [],
  answers: [],
  engineLatencyMs: 184.4,
  action: { skill: "idle" },
};

describe("formatTick", () => {
  it("shows the next_action answer, latency and skill events", () => {
    const entry: TickLog = {
      ...base,
      answers: [{ kind: "choice", id: "next_action", choice: "attack", probabilities: { attack: 0.76, flee: 0.24 }, confidence: 0.68 }],
      action: { skill: "attack" },
      skillEvents: [
        { skill: "idle", type: "interrupted", timestamp: 0 },
        { skill: "attack", type: "started", timestamp: 0 },
      ],
    };
    expect(formatTick(entry)).toBe("tick 3  attack p=0.76 conf=0.68  184ms  | idle interrupted, attack started");
  });

  it("shows the other answers compactly, and skill targets", () => {
    const entry: TickLog = {
      ...base,
      answers: [
        { kind: "choice", id: "next_action", choice: "attack", probabilities: { attack: 0.5 }, confidence: 0.4 },
        { kind: "choice", id: "target", choice: "entity:42", probabilities: { "entity:42": 0.9 }, confidence: 0.9 },
        { kind: "noul", id: "in_danger", value: 0.812 },
        { kind: "score", id: "mining_spot_quality", score: 3.46, confidence: 0.5 },
      ],
      skillEvents: [{ skill: "attack", target: "entity:42", type: "started", timestamp: 0 }],
    };
    expect(formatTick(entry)).toBe(
      "tick 3  attack p=0.50 conf=0.40  184ms  target=entity:42 in_danger=0.81 mining_spot_quality=3.5  | attack (entity:42) started",
    );
  });

  it("falls back to the action without a next_action answer", () => {
    expect(formatTick(base)).toBe("tick 3  idle  184ms");
    expect(formatTick({ ...base, action: { keepGoing: true } })).toBe("tick 3  keep going  184ms");
  });

  it("shows failure reasons", () => {
    const entry: TickLog = { ...base, skillEvents: [{ skill: "eat", type: "failed", reason: "cannot run", timestamp: 0 }] };
    expect(formatTick(entry)).toBe("tick 3  idle  184ms  | eat failed (cannot run)");
  });
});
