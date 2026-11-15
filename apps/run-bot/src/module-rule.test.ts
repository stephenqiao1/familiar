import { describe, expect, it } from "vitest";
import { doorwayViolations, moduleRuleViolations } from "../scripts/skill-check/module-rule.ts";

describe("the module rules", () => {
  it("no game-agnostic package imports Minecraft code", () => {
    expect(moduleRuleViolations()).toEqual([]);
  });

  it("one doorway: nothing outside primitives/ and the pathfinding helpers moves the bot's body", () => {
    expect(doorwayViolations()).toEqual([]);
  });

  it("catches a skill that calls the bot directly", () => {
    const found = doorwayViolations(["apps/run-bot/scripts/skill-check/fixtures"]);
    expect(found).toHaveLength(2);
    expect(found[0]).toMatch(/bad-skill\.ts:\d+: bot\.setControlState\("forward", true\);/);
    expect(found[1]).toMatch(/bad-skill\.ts:\d+: await bot\.dig\(block\);/);
  });
});
