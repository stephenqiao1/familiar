import { describe, expect, it } from "vitest";
import { doorwayViolations, moduleRuleViolations, travelViolations } from "../scripts/skill-check/module-rule.ts";

describe("the module rules", () => {
  it("no game-agnostic package imports Minecraft code", () => {
    expect(moduleRuleViolations()).toEqual([]);
  });

  it("one doorway: nothing outside primitives/ and locomotion/ moves the bot's body", () => {
    expect(doorwayViolations()).toEqual([]);
  });

  it("catches a skill that calls the bot directly", () => {
    const found = doorwayViolations(["apps/run-bot/scripts/skill-check/fixtures"]);
    expect(found.filter((line) => line.includes("bad-skill"))).toHaveLength(2);
    expect(found[0]).toMatch(/bad-skill\.ts:\d+: bot\.setControlState\("forward", true\);/);
    expect(found[1]).toMatch(/bad-skill\.ts:\d+: await bot\.dig\(block\);/);
  });

  it("one traveller: nothing outside locomotion/ touches the pathfinder or holds keys for travel", () => {
    expect(travelViolations()).toEqual([]);
  });

  it("catches a skill that drives the pathfinder or holds a movement key itself", () => {
    const found = travelViolations(["apps/run-bot/scripts/skill-check/fixtures"]);
    expect(found).toHaveLength(2);
    expect(found[0]).toMatch(/bad-travel\.ts:\d+: bot\.pathfinder\.setGoal\(goal\);/);
    expect(found[1]).toMatch(/bad-travel\.ts:\d+: holdKey\(bot, "forward", true\);/);
  });
});
