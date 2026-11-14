import type { Skill, State } from "@familiar/contracts";
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "../encode/encode-state.js";
import { approachableThings, noticedIn, skillsToward, thingsInView } from "./cues.js";

const nearby = {
  hazards: [{ id: "pos:0,62,5", type: "lava", dist: 5 }],
  mobs: [{ id: "entity:3", type: "villager", dist: 2, hostile: false }],
  blocks: [{ id: "pos:3,63,0", type: "chest", dist: 3 }],
  players: [{ id: "entity:9", type: "player", dist: 9 }],
};
const self = { biome: "plains", inventory: { bread: 2, stone_sword: 1 } };
const state = (schemaVersion = SCHEMA_VERSION): State => ({ schemaVersion, tick: 0, timestamp: 0, data: { self, nearby } });

describe("thingsInView", () => {
  it("lists every nearby thing with its kind, nearest first", () => {
    expect(thingsInView(state())).toEqual([
      { id: "entity:3", kind: "villager" },
      { id: "pos:3,63,0", kind: "chest" },
      { id: "pos:0,62,5", kind: "lava" },
      { id: "entity:9", kind: "player" },
    ]);
  });

  it("sees nothing in a state that is not a Minecraft state", () => {
    expect(thingsInView(state(1))).toEqual([]);
  });
});

describe("approachableThings", () => {
  it("leaves out hazards and hostile mobs", () => {
    const data = { self, nearby: { ...nearby, mobs: [...nearby.mobs, { id: "entity:5", type: "skeleton", dist: 1, hostile: true }] } };
    const withThreat: State = { schemaVersion: SCHEMA_VERSION, tick: 0, timestamp: 0, data };
    expect(approachableThings(withThreat)).toEqual([
      { id: "entity:3", kind: "villager" },
      { id: "pos:3,63,0", kind: "chest" },
      { id: "entity:9", kind: "player" },
    ]);
  });
});

describe("skillsToward", () => {
  it("offers go_to when it can reach the thing", () => {
    const goTo: Skill<null> = {
      name: "go_to",
      description: "",
      canRun: (_ctx, target) => target === "pos:3,63,0",
      run: async () => ({ status: "done" }),
    };
    const toward = skillsToward([goTo], null);
    expect(toward({ id: "pos:3,63,0", kind: "chest" })).toEqual(["go_to"]);
    expect(toward({ id: "pos:9,9,9", kind: "chest" })).toEqual([]);
    expect(skillsToward([], null)({ id: "pos:3,63,0", kind: "chest" })).toEqual([]);
  });
});

describe("noticedIn", () => {
  it("notices mobs, useful blocks, players, the biome and items, but not hazards", () => {
    expect(noticedIn(state())).toEqual(["villager", "chest", "player", "biome:plains", "item:bread", "item:stone_sword"]);
  });

  it("notices nothing in a state that is not a Minecraft state", () => {
    expect(noticedIn(state(1))).toEqual([]);
  });
});
