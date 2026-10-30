import { describe, expect, it } from "vitest";
import { listTargets } from "./list-targets.js";

const state = (nearby: object, schemaVersion = 2) => ({ schemaVersion, tick: 0, timestamp: 0, data: { nearby } });

describe("listTargets", () => {
  it("merges ores, hazards and mobs, nearest first", () => {
    const nearby = {
      ores: [{ id: "pos:1,60,0", type: "iron_ore", dist: 3 }, { id: "pos:9,60,0", type: "coal_ore", dist: 9 }],
      hazards: [{ id: "pos:0,62,5", type: "lava", dist: 5 }],
      mobs: [{ id: "entity:42", type: "zombie", dist: 2, hostile: true }],
    };
    expect(listTargets(state(nearby))).toEqual(["entity:42", "pos:1,60,0", "pos:0,62,5", "pos:9,60,0"]);
  });

  it("is empty when nothing is nearby", () => {
    expect(listTargets(state({ ores: [], hazards: [], mobs: [] }))).toEqual([]);
  });

  it("rejects an older state schema", () => {
    expect(() => listTargets(state({ ores: [], hazards: [], mobs: [] }, 1))).toThrow(/schemaVersion 2/);
  });
});
