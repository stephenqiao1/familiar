import { describe, expect, it } from "vitest";
import { excessOver } from "./deposit-items.js";
import { countByName } from "../encode/encode-self.js";
import { stillWanted } from "./storage.js";

const stack = (name: string, count: number, type = 1) => ({ type, name, count });

describe("stillWanted", () => {
  it("is what the goal wants minus what the bot carries", () => {
    const carried = countByName([stack("bread", 2), stack("bread", 1), stack("torch", 20)]);
    expect(stillWanted([{ item: "bread", count: 8 }, { item: "torch", count: 16 }, { item: "stone_sword", count: 1 }], carried)).toEqual([
      { item: "bread", count: 5 },
      { item: "stone_sword", count: 1 },
    ]);
  });

  it("is nothing when the goal wants nothing", () => {
    expect(stillWanted([], countByName([stack("bread", 2)]))).toEqual([]);
  });
});

describe("excessOver", () => {
  it("stores everything beyond what the goal keeps, by item type", () => {
    const items = [stack("bread", 10, 1), stack("cobblestone", 64, 2), stack("cobblestone", 30, 2), stack("stone_sword", 1, 3)];
    expect(excessOver(items, { bread: 8, stone_sword: 1 })).toEqual([stack("bread", 2, 1), stack("cobblestone", 94, 2)]);
  });
});
