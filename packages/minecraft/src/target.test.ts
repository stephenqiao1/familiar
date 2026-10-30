import { describe, expect, it } from "vitest";
import { parseTarget } from "./target.js";

describe("parseTarget", () => {
  it("parses nearest:<name> for blocks and mobs", () => {
    expect(parseTarget("nearest:iron_ore")).toEqual({ kind: "nearest", name: "iron_ore" });
    expect(parseTarget("nearest:zombie")).toEqual({ kind: "nearest", name: "zombie" });
  });

  it("parses pos:x,y,z including negatives, decimals and spaces", () => {
    expect(parseTarget("pos:-22,63,6")).toEqual({ kind: "pos", x: -22, y: 63, z: 6 });
    expect(parseTarget("pos: 1.5, 64 ,-3.25")).toEqual({ kind: "pos", x: 1.5, y: 64, z: -3.25 });
  });

  it("parses entity:<id>", () => {
    expect(parseTarget("entity:42")).toEqual({ kind: "entity", id: 42 });
  });

  it("parses player:<username>", () => {
    expect(parseTarget("player:Steve_99")).toEqual({ kind: "player", username: "Steve_99" });
  });

  it.each([
    "",
    "iron_ore",
    "nearest:",
    "nearest:Iron Ore",
    "pos:1,2",
    "pos:1,2,3,4",
    "pos:1,,3",
    "pos:a,b,c",
    "pos:1,2,Infinity",
    "entity:",
    "entity:-1",
    "entity:abc",
    "player:",
    "player:has space",
    "player:waytoolongusername123",
    "block:stone",
  ])("rejects %j", (input) => {
    expect(parseTarget(input)).toBeNull();
  });
});
