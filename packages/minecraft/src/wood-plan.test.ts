import { describe, expect, it } from "vitest";
import { assignWood } from "./wood-plan.js";

const sticks = { item: "stick", planks: 2 };
const table = { item: "crafting_table", planks: 4 };
const pickaxe = { item: "wooden_pickaxe", planks: 3 };

describe("assignWood", () => {
  it("uses one wood type when it has enough", () => {
    expect(assignWood(new Map([["oak_planks", 9]]), [sticks, table, pickaxe])).toEqual([
      "oak_planks",
      "oak_planks",
      "oak_planks",
    ]);
  });

  it("splits jobs across wood types so none mixes woods", () => {
    // 2 oak + 4 birch: sticks from oak, table from birch. A 3-plank pickaxe fits nowhere.
    const stock = new Map([["oak_planks", 2], ["birch_planks", 4]]);
    expect(assignWood(stock, [sticks, table])).toEqual(["oak_planks", "birch_planks"]);
    expect(assignWood(stock, [sticks, table, pickaxe])).toBeNull();
  });

  it("finds a fit that a greedy first choice would miss", () => {
    // Sticks must avoid spruce, or the 4-plank table has nowhere to go.
    const stock = new Map([["spruce_planks", 4], ["oak_planks", 2]]);
    expect(assignWood(stock, [sticks, table])).toEqual(["oak_planks", "spruce_planks"]);
  });

  it("returns null with 3 planks split 2 oak + 1 birch", () => {
    expect(assignWood(new Map([["oak_planks", 2], ["birch_planks", 1]]), [pickaxe])).toBeNull();
  });

  it("succeeds with no jobs", () => {
    expect(assignWood(new Map(), [])).toEqual([]);
  });
});
