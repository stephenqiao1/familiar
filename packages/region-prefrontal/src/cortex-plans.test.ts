// The prefrontal region and the rest of the cortex: steps in full, a priority, graded hold-backs,
// a goal the goal channel keeps, and being woken at once by a stuck step.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan, Planner, PlanRequest, Step } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { createNotes } from "./notes.js";
import { createPrefrontalRegion, REVIEW_EVERY_MS, URGENT_GAP_MS, type PrefrontalOptions } from "./prefrontal-region.js";

const signal = new AbortController().signal;
/** A region whose planner gives these plans in turn (the last one again after that). */
function setUp(plans: Plan[], more: Partial<PrefrontalOptions> = {}, store = createWorkspace()) {
  const requests: PlanRequest[] = [];
  let at = 0;
  const planner: Planner = { name: "fixed", plan: async (request) => (requests.push(request), plans[Math.min(at++, plans.length - 1)]!) };
  const region = createPrefrontalRegion({ planner, describe: () => "s", ...more });
  const ws = store.viewFor("prefrontal");
  return { store, ws, requests, region, plan: () => region.run(ws, signal) };
}
const walk: Step = { text: "walk to the chest", skill: "go_to", target: "pos:1,2,3", doneWhen: "within 3 of chest" };
const checkable = (step: Step) => step.doneWhen !== undefined;

describe("a plan with steps in full", () => {
  it("is written into the goal with its priority", async () => {
    const p = setUp([{ goal: "g", steps: [walk, "look about"], reason: "", priority: 0.8 }]);
    await p.plan();
    expect(p.store.goal()).toMatchObject({ steps: ["walk to the chest", "look about"], specs: [walk, { text: "look about" }], priority: 0.8 });
  });

  it("the planner's count does not move past a step the code can judge", async () => {
    const plan = { goal: "g", steps: ["look about", walk, "rest"], reason: "" };
    const p = setUp([plan, { ...plan, stepsDone: 3 }], { checkable });
    await p.plan();
    const { trace } = await p.plan();
    // It reported all three done: only the first, which has no condition, is taken from it.
    expect(p.store.goal()!.stepsDone).toBe(1);
    expect(trace).toMatchObject({ stepFinished: true });
    await p.plan();
    expect(p.store.goal()!.stepsDone).toBe(1);
  });

  it("keeps the steps the motor area finished while the planner was thinking", async () => {
    const plan = { goal: "g", steps: [walk, "rest"], reason: "" };
    const p = setUp([plan], { checkable });
    await p.plan();
    const slow: Planner = { name: "slow", plan: async () => (p.ws.finishStep(), plan) };
    await createPrefrontalRegion({ planner: slow, describe: () => "", checkable }).run(p.ws, signal);
    expect(p.store.goal()).toMatchObject({ stepsDone: 1 });
  });

  it("a step that changes in any part starts the count again", async () => {
    const p = setUp([{ goal: "g", steps: ["look", walk], reason: "" }, { goal: "g", steps: ["look", walk], reason: "", stepsDone: 1 }, { goal: "g", steps: ["look", { ...walk, doneWhen: "within 2 of chest" }], reason: "", stepsDone: 1 }]);
    await p.plan();
    await p.plan();
    expect(p.store.goal()!.stepsDone).toBe(1);
    await p.plan();
    expect(p.store.goal()!.stepsDone).toBe(0);
  });
});

describe("hold-backs across plans", () => {
  it("one with an end keeps the time and the step it started at when the next plan says it again", async () => {
    const held = { name: "flee", strength: 0.5, until: "step" as const };
    const plan = { goal: "g", steps: ["a", "b"], reason: "", holdBack: [held, "eat"] };
    const p = setUp([plan, { ...plan, stepsDone: 1 }]);
    await p.plan();
    const first = p.store.goal()!.holdBack[0]!;
    expect(first).toMatchObject({ name: "flee", strength: 0.5, until: "step", step: 0 });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await p.plan();
    // The goal is on its second step now, but the hold-back still belongs to the first: it has ended.
    expect(p.store.goal()).toMatchObject({ stepsDone: 1, holdBack: [{ name: "flee", step: 0, since: first.since }, { name: "eat", strength: 1 }] });
  });

  it("one whose end changes starts afresh", async () => {
    const p = setUp([{ goal: "g", steps: [], reason: "", holdBack: [{ name: "flee", strength: 1, until: 5 }] }, { goal: "g", steps: [], reason: "", holdBack: [{ name: "flee", strength: 1, until: 9 }] }]);
    await p.plan();
    const first = p.store.goal()!.holdBack[0]!.since!;
    await new Promise((resolve) => setTimeout(resolve, 2));
    await p.plan();
    expect(p.store.goal()!.holdBack[0]!.since).toBeGreaterThan(first);
  });
});

describe("a goal the goal channel keeps", () => {
  it("is left standing, and the trace says why", async () => {
    const store = createWorkspace({ goalGate: (_offered, standing) => (standing.protected ? "protected" : null) });
    store.viewFor("noradrenaline").setGoal({ text: "Retreat.", steps: [], reason: "", protected: true });
    const p = setUp([{ goal: "Mine.", steps: [], reason: "" }], {}, store);
    const { trace } = await p.plan();
    expect(store.goal()).toMatchObject({ text: "Retreat.", setBy: "noradrenaline" });
    expect(trace).toMatchObject({ goalKept: "protected", plan: { goal: "Mine." } });
  });
});

describe("woken by the cortex", () => {
  beforeEach(() => void vi.useFakeTimers({ now: 100_000 }));
  afterEach(() => void vi.useRealTimers());

  it("a stuck step makes it due at once, the planner is told why, and each report is answered once", async () => {
    let stuck: { key: number; note: string } | null = null;
    const p = setUp([{ goal: "g", steps: [], reason: "" }], { urgent: () => stuck });
    expect(p.region.dueNow!(p.ws)).toBe(false);
    stuck = { key: 1, note: "Step 1 is stuck: go_to failed 3 times." };
    expect(p.region.dueNow!(p.ws)).toBe(true);
    const { trace } = await p.plan();
    expect(p.requests[0]).toMatchObject({ woken: "Step 1 is stuck: go_to failed 3 times." });
    expect(trace).toMatchObject({ woken: "Step 1 is stuck: go_to failed 3 times." });
    // The same report does not wake it twice.
    vi.advanceTimersByTime(60_000);
    expect(p.region.dueNow!(p.ws)).toBe(false);
    await p.plan();
    expect(p.requests[1]!.woken).toBeUndefined();
  });

  it("never plans for the cortex sooner than five seconds after the plan before", async () => {
    let stuck: { key: number; note: string } | null = null;
    const p = setUp([{ goal: "g", steps: [], reason: "" }], { urgent: () => stuck });
    await p.plan();
    stuck = { key: 1, note: "stuck" };
    expect(p.region.dueNow!(p.ws)).toBe(false);
    vi.advanceTimersByTime(URGENT_GAP_MS - 1);
    expect(p.region.dueNow!(p.ws)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(p.region.dueNow!(p.ws)).toBe(true);
    await p.plan();
    // A second report straight after waits its five seconds too.
    stuck = { key: 2, note: "stuck again" };
    expect(p.region.dueNow!(p.ws)).toBe(false);
    vi.advanceTimersByTime(URGENT_GAP_MS);
    expect(p.region.dueNow!(p.ws)).toBe(true);
  });

  it("a reason that can wait does not bring the plan forward: its note goes with the next plan in turn, once", async () => {
    const p = setUp([{ goal: "g", steps: [], reason: "" }], { urgent: () => ({ key: 1, note: "There is trouble.", wait: true }) });
    vi.advanceTimersByTime(60_000);
    expect(p.region.dueNow!(p.ws)).toBe(false);
    const { trace } = await p.plan();
    expect(p.requests[0]).toMatchObject({ woken: "There is trouble." });
    expect(trace).toMatchObject({ told: "There is trouble." });
    expect(trace!.woken).toBeUndefined();
    await p.plan();
    expect(p.requests[1]!.woken).toBeUndefined();
  });

  it("is not woken while paused", () => {
    const p = setUp([{ goal: "g", steps: [], reason: "" }], { urgent: () => ({ key: 1, note: "stuck" }), paused: () => true });
    expect(p.region.dueNow!(p.ws)).toBe(false);
  });
});

describe("naming a routine", () => {
  const routine = { steps: [{ skill: "go_to", target: "nearest:chest" }, { skill: "take_items" }], doneWhen: "carrying 1 bread", taken: ["go_to"] };

  it("after a plan, the planner is asked once to name the routine that is waiting, and what it said is passed on", async () => {
    const waiting = [routine];
    const named: unknown[] = [];
    const asked: unknown[] = [];
    const planner: Planner = { name: "p", plan: async () => ({ goal: "g", steps: [], reason: "" }), nameRoutine: async (request) => (asked.push(request), { name: "fetch", description: "Fetch what is wanted." }) };
    const region = createPrefrontalRegion({ planner, describe: () => "", naming: { next: () => waiting[0] ?? null, named: (request, given) => (named.push([request, given]), waiting.shift(), "fetch") } });
    const ws = createWorkspace().viewFor("prefrontal");
    expect((await region.run(ws, signal)).trace).toMatchObject({ named: { routine: routine.steps, doneWhen: "carrying 1 bread", given: { name: "fetch" }, as: "fetch" } });
    expect(asked).toEqual([routine]);
    expect(named).toEqual([[routine, { name: "fetch", description: "Fetch what is wanted." }]]);
    // Nothing waiting: nothing is asked.
    expect((await region.run(ws, signal)).trace!.named).toBeUndefined();
    expect(asked).toHaveLength(1);
  });

  it("a planner that cannot name, or fails to, leaves the naming to whoever keeps the skill", async () => {
    const given: unknown[] = [];
    const naming = { next: () => routine, named: (_request: unknown, said: unknown) => (given.push(said), "go_to_then_take_items") };
    const ws = createWorkspace().viewFor("prefrontal");
    const plain: Planner = { name: "p", plan: async () => ({ goal: "g", steps: [], reason: "" }) };
    const failing: Planner = { ...plain, nameRoutine: async () => Promise.reject(new Error("no")) };
    for (const planner of [plain, failing]) expect((await createPrefrontalRegion({ planner, describe: () => "", naming }).run(ws, signal)).trace).toMatchObject({ named: { as: "go_to_then_take_items" } });
    expect(given).toEqual([null, null]);
  });
});


describe("a review at rest", () => {
  const plan: Plan = { goal: "g", steps: [], reason: "", notes: [{ key: "bed", text: "the bed is by the door" }] };
  /** A planner that plans `plan` and, at a review, says `said`. */
  function resting(said: Awaited<ReturnType<NonNullable<Planner["review"]>>> | Error, due: () => string | number | null = () => 1) {
    const store = createWorkspace();
    const notes = createNotes();
    const seen: { plans: number; reviews: Parameters<NonNullable<Planner["review"]>>[0][] } = { plans: 0, reviews: [] };
    const planner: Planner = {
      name: "fixed",
      plan: async () => (seen.plans++, plan),
      review: async (request) => {
        seen.reviews.push(request);
        if (said instanceof Error) throw said;
        return said;
      },
    };
    const region = createPrefrontalRegion({ planner, describe: () => "s", notes, review: () => ((key) => (key === null ? null : { key, memories: ["fell in the pond"], feeling: "at ease" }))(due()) });
    return { store, notes, seen, run: () => region.run(store.viewFor("prefrontal"), signal) };
  }
  beforeEach(() => void vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => void vi.useRealTimers());

  it("with no goal standing the plan comes first, then the review in place of the next plan", async () => {
    const p = resting({ notes: [{ key: "bed", text: "the bed is by the door" }] });
    await p.run();
    expect(p.seen).toMatchObject({ plans: 1, reviews: [] });
    const { trace } = await p.run();
    expect(p.seen.plans).toBe(1);
    expect(p.seen.reviews).toEqual([{ notes: [{ key: "bed", text: "the bed is by the door" }], memories: ["fell in the pond"], feeling: "at ease" }]);
    expect(trace).toMatchObject({ review: { notes: { kept: ["bed"], now: ["bed"] } } });
  });

  it("changes the notes and nothing else", async () => {
    const p = resting({ notes: [{ key: "bed", text: "the bed is upstairs" }, { key: "pond", text: "keep clear of the pond" }] });
    await p.run();
    const goal = p.store.goal();
    const { trace } = await p.run();
    expect(p.store.goal()).toEqual(goal);
    expect(p.notes.list().map(({ key, text }) => ({ key, text }))).toEqual([{ key: "bed", text: "the bed is upstairs" }, { key: "pond", text: "keep clear of the pond" }]);
    expect(trace).toMatchObject({ review: { notes: { changed: ["bed"], added: ["pond"] } } });
    expect(trace).not.toHaveProperty("plan");
  });

  it("comes once in a spell, and no sooner than ten minutes after the last", async () => {
    let spell = 1;
    const p = resting({ notes: plan.notes! }, () => spell);
    await p.run();
    await p.run();
    await p.run();
    expect(p.seen).toMatchObject({ plans: 2, reviews: [{}] });
    // A new spell too soon: a plan as usual.
    spell = 2;
    vi.advanceTimersByTime(REVIEW_EVERY_MS - 1);
    await p.run();
    expect(p.seen.reviews).toHaveLength(1);
    vi.advanceTimersByTime(1);
    await p.run();
    expect(p.seen.reviews).toHaveLength(2);
  });

  it("is not asked for while not at rest, or of a planner that cannot review", async () => {
    const p = resting({ notes: [] }, () => null);
    await p.run();
    await p.run();
    expect(p.seen).toMatchObject({ plans: 2, reviews: [] });
    const store = createWorkspace();
    let plans = 0;
    const region = createPrefrontalRegion({ planner: { name: "plain", plan: async () => (plans++, plan) }, describe: () => "s", notes: createNotes(), review: () => ({ key: 1, memories: [], feeling: null }) });
    await region.run(store.viewFor("prefrontal"), signal);
    await region.run(store.viewFor("prefrontal"), signal);
    expect(plans).toBe(2);
  });

  it("goes ahead while plans are held back", async () => {
    const store = createWorkspace();
    const seen = { plans: 0, reviews: 0 };
    let paused = false;
    const planner: Planner = { name: "fixed", plan: async () => (seen.plans++, plan), review: async () => (seen.reviews++, {}) };
    const region = createPrefrontalRegion({ planner, describe: () => "s", notes: createNotes(), paused: () => paused, review: () => ({ key: 1, memories: [], feeling: null }) });
    const run = () => region.run(store.viewFor("prefrontal"), signal);
    await run();
    paused = true;
    expect((await run()).trace).toHaveProperty("review");
    expect((await run()).trace).toEqual({ paused: true });
    expect(seen).toEqual({ plans: 1, reviews: 1 });
  });

  it("one that fails is not asked again in the same spell", async () => {
    const p = resting(new Error("no answer"));
    await p.run();
    await expect(p.run()).rejects.toThrow("no answer");
    await p.run();
    expect(p.seen).toMatchObject({ plans: 2, reviews: [{}] });
    expect(p.notes.list()).toHaveLength(1);
  });
});
