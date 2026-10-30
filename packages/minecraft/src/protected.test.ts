import { describe, expect, it } from "vitest";
import { isProtectedBlock } from "./protected.js";

describe("isProtectedBlock", () => {
  it.each(["chest", "red_bed", "white_bed", "crafting_table", "furnace"])("protects %s", (name) => {
    expect(isProtectedBlock(name)).toBe(true);
  });

  it.each(["stone", "iron_ore", "dirt", "bedrock"])("allows %s", (name) => {
    expect(isProtectedBlock(name)).toBe(false);
  });
});
