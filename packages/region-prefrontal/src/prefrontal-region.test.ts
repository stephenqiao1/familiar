import { describe, expect, it } from "vitest";
import type { Planner, PlanRequest } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { areaRegions } from "@familiar/neocortex";
import { createPrefrontalArea, createPrefrontalRegion } from "./prefrontal-region.js";

describe("createPrefrontalRegion", () => {
  it("runs in the background on the slowest layer by default", () => {
    const planner: Planner = { name: "p", plan: async () => ({ goal: "", steps: [], reason: "" }) };
    expect(createPrefrontalRegion({ planner, describe: () => "" })).toMatchObject({ name: "prefrontal", layer: 2, everyMs: 15_000 });
  });

  it("writes the plan as the goal and proposes nothing", async () => {
    const requests: PlanRequest[] = [];
    const planner: Planner = {
      name: "fixed",
      plan: async (request) => {
        requests.push(request);
        return { goal: "build a shelter", steps: ["gather wood"], reason: "night is coming", wants: [{ item: "torch", count: 8 }] };
      },
    };
    const store = createWorkspace();
    const region = createPrefrontalRegion({ planner, describe: () => "in a forest, holding a sword" });

    const out = await region.run(store.viewFor("prefrontal"), new AbortController().signal);

    expect(out.proposals).toEqual([]);
    expect(requests).toEqual([{ situation: "in a forest, holding a sword", currentGoal: null }]);
    expect(store.goal()).toMatchObject({ text: "build a shelter", steps: ["gather wood"], wants: [{ item: "torch", count: 8 }], setBy: "prefrontal" });
    expect(out.trace).toMatchObject({ planner: "fixed", plan: { goal: "build a shelter" } });
  });

  describe("steps done", () => {
    /** Plans in turn: each entry is the steps to return and how many of the shown goal's steps are done. */
    async function replan(plans: { steps: string[]; stepsDone?: number }[]) {
      const queue = [...plans];
      const planner: Planner = { name: "fixed", plan: async () => ({ goal: "g", reason: "", ...queue.shift()! }) };
      const store = createWorkspace();
      const region = createPrefrontalRegion({ planner, describe: () => "" });
      const goals = [];
      for (let i = 0; i < plans.length; i++) {
        await region.run(store.viewFor("prefrontal"), new AbortController().signal);
        goals.push(store.goal()!);
      }
      return goals;
    }

    it("starts a goal with no steps done, then counts them and notes when one was finished", async () => {
      const steps = ["a", "b", "c"];
      const [first, second, third] = await replan([{ steps, stepsDone: 2 }, { steps, stepsDone: 1 }, { steps, stepsDone: 1 }]);
      expect(first).toMatchObject({ stepsDone: 0, stepDoneAt: null }); // nothing was shown yet, so nothing can be done
      expect(second).toMatchObject({ stepsDone: 1, stepDoneAt: expect.any(Number) });
      expect(third).toMatchObject({ stepsDone: 1, stepDoneAt: second!.stepDoneAt }); // no new step: the time stays
    });

    it("never counts more steps than the goal has, and never goes backwards", async () => {
      const steps = ["a", "b"];
      const goals = await replan([{ steps }, { steps, stepsDone: 9 }, { steps, stepsDone: 0 }]);
      expect(goals.map((g) => g.stepsDone)).toEqual([0, 2, 2]);
    });

    it("starts the count again when the steps change, but remembers when a step was last finished", async () => {
      const goals = await replan([{ steps: ["a", "b"] }, { steps: ["a", "b"], stepsDone: 1 }, { steps: ["x", "y"], stepsDone: 2 }]);
      expect(goals[2]).toMatchObject({ steps: ["x", "y"], stepsDone: 0, stepDoneAt: expect.any(Number) });
      expect(goals[2]!.stepDoneAt).toBeGreaterThanOrEqual(goals[1]!.stepDoneAt!);
    });
  });

  it("skips planning while paused, and asks to run early when woken", async () => {
    let calls = 0;
    const planner: Planner = { name: "fixed", plan: async () => (calls++, { goal: "g", steps: [], reason: "" }) };
    const state = { paused: true, wake: true };
    const region = createPrefrontalRegion({ planner, describe: () => "", paused: () => state.paused, wake: () => state.wake });
    const ws = createWorkspace().viewFor("prefrontal");
    expect(await region.run(ws, new AbortController().signal)).toEqual({ proposals: [], trace: { paused: true } });
    expect(calls).toBe(0);
    expect(region.dueNow?.(ws)).toBe(false); // paused wins over a wake
    state.paused = false;
    expect(region.dueNow?.(ws)).toBe(true);
    await region.run(ws, new AbortController().signal);
    expect(calls).toBe(1);
  });

  it("adds guidance to the situation and caps the steps", async () => {
    let asked = "";
    const planner: Planner = {
      name: "fixed",
      plan: async ({ situation }) => ((asked = situation), { goal: "g", steps: ["a", "b", "c"], reason: "" }),
    };
    const store = createWorkspace();
    const region = createPrefrontalRegion({ planner, describe: () => "calm", guidance: () => ({ instruction: "Think short.", maxSteps: 2 }) });
    await region.run(store.viewFor("prefrontal"), new AbortController().signal);
    expect(asked).toBe("calm\nThink short.\nPlan at most 2 steps.");
    expect(store.goal()?.steps).toEqual(["a", "b"]);
  });

  it("sets a goal that wants nothing when the plan lists no items", async () => {
    const planner: Planner = { name: "fixed", plan: async () => ({ goal: "explore", steps: [], reason: "" }) };
    const store = createWorkspace();
    await createPrefrontalRegion({ planner, describe: () => "" }).run(store.viewFor("prefrontal"), new AbortController().signal);
    expect(store.goal()?.wants).toEqual([]);
  });
});

describe("createPrefrontalArea", () => {
  const signal = new AbortController().signal;
  const plans = [
    { goal: "build", steps: ["wood", "walls"], reason: "night", detail: ["chest"], holdBack: ["flee"] },
    { goal: "build", steps: ["wood", "walls"], reason: "night", stepsDone: 1, detail: ["chest", "bed"] },
    { goal: "hide", steps: ["dig in"], reason: "zombies", stepsDone: 2 },
  ];
  const options = () => {
    const queue = [...plans];
    const planner: Planner = { name: "fixed", plan: async () => queue.shift()! };
    return { planner, describe: () => "s", guidance: () => ({ maxSteps: 2 }), wake: () => true, everyMs: 5000, timeoutMs: 100 };
  };
  const plain = ({ setAt: _setAt, stepDoneAt, ...goal }: NonNullable<ReturnType<ReturnType<typeof createWorkspace>["goal"]>>) => ({ ...goal, stepped: stepDoneAt !== null });

  it("sets the same goals as the region, plan after plan, and feeds each down with its ask", async () => {
    const [old, now] = [createWorkspace(), createWorkspace()];
    const region = createPrefrontalRegion(options());
    const [hold, area] = areaRegions(createPrefrontalArea(options()), ["instinct", "prefrontal"]);
    expect(area).toMatchObject({ name: region.name, layer: region.layer, everyMs: 5000, timeoutMs: 100 });
    expect(area!.dueNow?.(now.viewFor("prefrontal"))).toBe(true);
    for (const plan of plans) {
      const before = await region.run(old.viewFor("prefrontal"), signal);
      const after = await area!.run(now.viewFor("prefrontal"), signal);
      expect(after.proposals).toEqual(before.proposals);
      const { ports, ...trace } = after.trace as Record<string, unknown>;
      expect(trace).toEqual(before.trace);
      expect(plain(now.goal()!)).toEqual(plain(old.goal()!));
      expect(ports).toMatchObject({ input: "prefrontal", up: null, action: [], ask: plan.detail ?? [], down: { goal: now.goal() } });
      expect(now.cortex().prefrontal).toMatchObject({ feedback: { goal: now.goal() }, ask: plan.detail ?? [] });
    }
    // Paused, it plans nothing, like the region; what it holds is still said every tick.
    const paused = { ...options(), paused: () => true };
    const was = await createPrefrontalRegion(paused).run(old.viewFor("prefrontal"), signal);
    const is = await areaRegions(createPrefrontalArea(paused), ["prefrontal"])[1]!.run(now.viewFor("prefrontal"), signal);
    expect(is.trace).toMatchObject(was.trace!);
    now.viewFor("noradrenaline").clearGoal();
    await hold!.run(now.viewFor("prefrontal-hold"), signal);
    expect(now.cortex().prefrontal).toMatchObject({ feedback: { goal: null }, ask: [] });
  });
});
