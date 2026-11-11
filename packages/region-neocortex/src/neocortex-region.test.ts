import { describe, expect, it } from "vitest";
import type { Planner, PlanRequest } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { createNeocortexRegion } from "./neocortex-region.js";

describe("createNeocortexRegion", () => {
  it("runs in the background on the slowest layer by default", () => {
    const planner: Planner = { name: "p", plan: async () => ({ goal: "", steps: [], reason: "" }) };
    expect(createNeocortexRegion({ planner, describe: () => "" })).toMatchObject({ name: "neocortex", layer: 2, everyMs: 15_000 });
  });

  it("writes the plan as the goal and proposes nothing", async () => {
    const requests: PlanRequest[] = [];
    const planner: Planner = {
      name: "fixed",
      plan: async (request) => {
        requests.push(request);
        return { goal: "find iron", steps: ["dig to y=16"], reason: "need a better pickaxe" };
      },
    };
    const store = createWorkspace();
    const region = createNeocortexRegion({ planner, describe: () => "underground, stone pickaxe" });

    const out = await region.run(store.viewFor("neocortex"), new AbortController().signal);

    expect(out.proposals).toEqual([]);
    expect(requests).toEqual([{ situation: "underground, stone pickaxe", currentGoal: null }]);
    expect(store.goal()).toMatchObject({ text: "find iron", steps: ["dig to y=16"], setBy: "neocortex" });
    expect(out.trace).toMatchObject({ planner: "fixed", plan: { goal: "find iron" } });
  });
});
