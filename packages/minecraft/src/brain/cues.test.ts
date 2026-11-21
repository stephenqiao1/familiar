import type { Skill, State } from "@familiar/contracts";
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "../encode/encode-state.js";
import { approachableThings, noticedIn, rememberedThings, skillsToward, thingsInView } from "./cues.js";

const nearby = {
  hazards: [{ id: "pos:0,62,5", type: "lava", dist: 5 }],
  mobs: [{ id: "entity:3", type: "villager", dist: 2, hostile: false, reachable: true }],
  blocks: [{ id: "pos:3,63,0", type: "chest", dist: 3 }],
  players: [{ id: "entity:9", type: "player", dist: 9 }],
};
const self = { biome: "plains", inventory: { bread: 2, stone_sword: 1 } };
const state = (schemaVersion = SCHEMA_VERSION): State => ({ schemaVersion, tick: 0, timestamp: 0, data: { self, nearby } });

describe("thingsInView", () => {
  it("lists every nearby thing with its kind, nearest first", () => {
    expect(thingsInView(state())).toEqual([
      { id: "entity:3", kind: "villager" },
      { id: "pos:3,63,0", kind: "chest", fixed: true }, // a block stays put: it is known by its own id
      { id: "pos:0,62,5", kind: "lava", fixed: true },
      { id: "entity:9", kind: "player" },
    ]);
  });

  it("sees nothing in a state that is not a Minecraft state", () => {
    expect(thingsInView(state(1))).toEqual([]);
  });
});

describe("approachableThings", () => {
  it("leaves out hazards and hostile mobs", () => {
    const data = { self, nearby: { ...nearby, mobs: [...nearby.mobs, { id: "entity:5", type: "skeleton", dist: 1, hostile: true, reachable: true }] } };
    const withThreat: State = { schemaVersion: SCHEMA_VERSION, tick: 0, timestamp: 0, data };
    expect(approachableThings(withThreat)).toEqual([
      { id: "entity:3", kind: "villager" },
      { id: "pos:3,63,0", kind: "chest", fixed: true },
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

describe("rememberedThings", () => {
  const at = (x: number): State => ({ schemaVersion: SCHEMA_VERSION, tick: 0, timestamp: 0, data: { self: { ...self, position: { x, y: 63, z: 0 } }, nearby } });
  const known = () => [
    { kind: "chest", id: "pos:3,63,0" }, // in the state now
    { kind: "chest", id: "pos:116,63,0" },
    { kind: "barrel", id: "pos:-10,63,0" },
    { kind: "lava", id: "pos:1,63,0" }, // not something to head to
    { kind: "cow", id: "entity:4" }, // not a place
  ];

  it("lists the useful blocks learned about that are not in the state, nearest first, each costed by the walk beyond sensing range", () => {
    const things = rememberedThings(known)(at(0));
    expect(things).toEqual([
      { id: "pos:-10,63,0", kind: "barrel", fixed: true, extraWork: 0 },
      { id: "pos:116,63,0", kind: "chest", fixed: true, extraWork: expect.any(Number) },
    ]);
    // 100 blocks past sensing range: about a third of what a desperate need pays.
    expect(things[1]!.extraWork).toBeGreaterThan(0.25);
    expect(things[1]!.extraWork).toBeLessThan(0.4);
  });

  it("works out the distance from where the bot is now, and minds it as much as the bot minds effort", () => {
    expect(rememberedThings(known)(at(100)).map((t) => t.id)).toEqual(["pos:116,63,0", "pos:-10,63,0"]);
    expect(rememberedThings(known, 0)(at(0))[1]!.extraWork).toBe(0);
    expect(rememberedThings(known)(state(1))).toEqual([]);
  });

  it("weighs only the nearest sixteen", () => {
    const many = () => Array.from({ length: 40 }, (_, i) => ({ kind: "chest", id: `pos:${30 + i},63,0` }));
    const things = rememberedThings(many)(at(0));
    expect(things).toHaveLength(16);
    expect(things[0]!.id).toBe("pos:30,63,0");
  });
});
