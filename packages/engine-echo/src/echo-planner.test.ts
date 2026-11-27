import { describe, expect, it } from "vitest";
import { EchoPlanner } from "./echo-planner.js";

const request = (woken?: string) => ({ situation: "", currentGoal: null, ...(woken ? { woken } : {}) });

describe("EchoPlanner", () => {
  it("returns its fixed plan every time, steps in full and all", async () => {
    const step = { text: "walk", skill: "go_to", doneWhen: "within 3 of chest" };
    const planner = new EchoPlanner({ goal: "g", steps: [step, "rest"], reason: "", holdBack: ["flee"] });
    expect(await planner.plan(request())).toEqual({ goal: "g", steps: [step, "rest"], reason: "", holdBack: ["flee"] });
    expect(await planner.plan(request("a step is stuck"))).toMatchObject({ goal: "g" });
    expect(await new EchoPlanner().plan()).toMatchObject({ goal: "Stay safe." });
  });

  it("given several plans, moves to the next each time it is woken out of turn, and stays on the last", async () => {
    const planner = new EchoPlanner([{ goal: "first", steps: [], reason: "" }, { goal: "second", steps: [], reason: "" }]);
    expect((await planner.plan(request())).goal).toBe("first");
    expect((await planner.plan(request())).goal).toBe("first");
    expect((await planner.plan(request("step 1 is stuck"))).goal).toBe("second");
    expect((await planner.plan(request())).goal).toBe("second");
    expect((await planner.plan(request("stuck again"))).goal).toBe("second");
  });

  it("also moves on when shown that the goal it gave is finished", async () => {
    const planner = new EchoPlanner([{ goal: "first", steps: ["a"], reason: "" }, { goal: "second", steps: ["b"], reason: "" }]);
    const shown = (text: string, stepsDone: number) => ({ situation: "", currentGoal: { text, steps: ["a"], stepsDone } as never });
    expect((await planner.plan(shown("first", 0))).goal).toBe("first");
    expect((await planner.plan(shown("something else", 1))).goal).toBe("first");
    expect((await planner.plan(shown("first", 1))).goal).toBe("second");
  });

  it("names a routine after its steps", async () => {
    expect(await new EchoPlanner().nameRoutine({ steps: [{ skill: "go_to", target: "nearest:chest" }, { skill: "take_items" }], doneWhen: "carrying 1 bread", taken: [] })).toEqual({
      name: "go_to_then_take_items",
      description: "Do go_to, then take_items (until carrying 1 bread).",
    });
  });
});
