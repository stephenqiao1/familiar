import { describe, expect, it } from "vitest";
import { cleanWants, planPrompt } from "./claude-planner.js";

describe("planPrompt", () => {
  it("puts the current goal before the situation", () => {
    const prompt = planPrompt({
      situation: "health 20/20",
      currentGoal: { text: "build a shelter", steps: ["gather wood"], reason: "", wants: [{ item: "torch", count: 8 }], watchFor: [], ifThen: [], holdBack: [], detail: [], stepsDone: 0, stepDoneAt: null, setBy: "prefrontal", setAt: 0 },
    });
    expect(prompt).toBe("Current goal: build a shelter\nSteps (0 of 1 done): gather wood\nCarry: 8 torch\n\nSituation:\nhealth 20/20\n\nSet the goal.");
  });

  it("says when there is no goal yet", () => {
    expect(planPrompt({ situation: "x", currentGoal: null })).toMatch(/^Current goal: none yet\./);
  });
});

describe("cleanWants", () => {
  it("rounds counts, drops empty ones, and keeps one entry per item", () => {
    expect(cleanWants([{ item: "bread", count: 4.6 }, { item: "torch", count: 0 }, { item: "", count: 2 }, { item: "bread", count: 8 }])).toEqual([
      { item: "bread", count: 8 },
    ]);
  });
});
