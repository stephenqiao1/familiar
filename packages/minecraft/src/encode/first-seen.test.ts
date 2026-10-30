import type { State } from "@familiar/contracts";
import { describe, expect, it } from "vitest";
import { createFirstSeenTracker } from "./first-seen.js";

const state = (timestamp: number, mobs: { id: string; type: string; dist: number; hostile: boolean }[]): State => ({
  schemaVersion: 2,
  tick: 0,
  timestamp,
  data: { nearby: { ores: [], hazards: [], mobs } },
});
const zombie = { id: "entity:7", type: "zombie", dist: 12, hostile: true };
const cow = { id: "entity:8", type: "cow", dist: 3, hostile: false };

describe("createFirstSeenTracker", () => {
  it("reports a hostile mob only the first time it appears", () => {
    const track = createFirstSeenTracker();
    expect(track(state(100, [cow]))).toEqual([]);
    expect(track(state(200, [cow, zombie]))).toEqual([{ mobId: "entity:7", type: "zombie", dist: 12, timestamp: 200 }]);
    expect(track(state(300, [zombie]))).toEqual([]);
    expect(track(state(400, []))).toEqual([]);
    expect(track(state(500, [zombie]))).toEqual([]);
  });

  it("copes with states that have no mob list", () => {
    expect(createFirstSeenTracker()({ schemaVersion: 1, tick: 0, timestamp: 0, data: {} })).toEqual([]);
  });
});
