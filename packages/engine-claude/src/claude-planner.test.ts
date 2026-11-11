import { describe, expect, it } from "vitest";
import { planPrompt } from "./claude-planner.js";

describe("planPrompt", () => {
  it("puts the current goal before the situation", () => {
    const prompt = planPrompt({
      situation: "health 20/20",
      currentGoal: { text: "find iron", steps: ["dig down"], reason: "", setBy: "neocortex", setAt: 0 },
    });
    expect(prompt).toBe("Current goal: find iron\nSteps: dig down\n\nSituation:\nhealth 20/20\n\nSet the goal.");
  });

  it("says when there is no goal yet", () => {
    expect(planPrompt({ situation: "x", currentGoal: null })).toMatch(/^Current goal: none yet\./);
  });
});
