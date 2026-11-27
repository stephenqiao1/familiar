import { describe, expect, it } from "vitest";
import type { GoalOffer, Region, SkillEvent, Step } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { areaRegions, createConditions, type ConditionKind } from "@familiar/neocortex";
import { createMotorArea, type MotorOptions } from "./motor-area.js";
import { UNLEARNED_MS } from "./step-run.js";

const signal = new AbortController().signal;
const LADDER = ["instinct", "motor", "prefrontal"];
/** "has <key>": true while the state's data has that key. */
const has: ConditionKind = { form: "has <key>", read: (text) => ((key) => (key ? (ws) => key in ws.state.data : null))(/^has (\w+)$/.exec(text)?.[1]) };
const conditions = createConditions([has]);

/** The motor area on a workspace of its own, with a goal held above it. */
function setUp(steps: (string | Step)[], more: Partial<MotorOptions> = {}, goal: Partial<GoalOffer> = {}) {
  const store = createWorkspace();
  const [motor] = areaRegions(createMotorArea({ strength: 1, parse: conditions.parse, skillProblem: (skill) => (skill === "nonsense" ? "not one of the listed abilities" : null), canStart: () => true, ...more }), LADDER) as [Region];
  const top = store.viewFor("prefrontal");
  top.setGoal({ text: "g", steps, reason: "", ...goal });
  let ms = 1000;
  /** One tick `afterMs` later, in a world whose data is `data`. The goal above is said again first, as the prefrontal cortex does. */
  let running: { skill: string; startedAt: number } | null = null;
  async function tick(data: Record<string, unknown> = {}, afterMs = 500) {
    ms += afterMs;
    store.update({ schemaVersion: 1, tick: 0, timestamp: ms, data }, running && { ...running, target: undefined });
    top.setCortex("prefrontal", { feedback: { goal: store.goal() } });
    const out = await motor.run(store.viewFor("motor"), signal);
    return { proposals: out.proposals, trace: out.trace as Record<string, any>, ports: store.cortex().motor! };
  }
  const event = (skill: string, type: SkillEvent["type"], reason?: string) => store.addEvent({ skill, type, timestamp: ms + 1, ...(reason ? { reason } : {}) });
  /** The skill starts running now (or, with null, nothing runs any more). */
  const run = (skill: string | null) => void (running = skill === null ? null : { skill, startedAt: ms });
  return { store, tick, event, run, now: () => ms };
}

describe("the motor area", () => {
  it("a step with a skill becomes an ordinary proposal worth the goal's priority", async () => {
    const m = setUp([{ text: "walk to the chest", skill: "go_to", target: "pos:1,2,3", doneWhen: "has chest" }]);
    const { proposals, ports } = await m.tick();
    expect(proposals).toEqual([{ action: { skill: "go_to", target: "pos:1,2,3" }, urgency: 0.5, reason: "step 1 of the goal: walk to the chest" }]);
    expect(ports.up).toEqual({ step: 0, as: "skill" });
    // The area below is given the goal, and no step to attend to: the motor area has it in hand.
    expect(ports.feedback).toMatchObject({ goal: { text: "g" }, step: null });
    const urgent = setUp([{ text: "walk", skill: "go_to", doneWhen: "has chest" }], { strength: 0.5, weightOf: () => 0.5 }, { priority: 0.8 });
    expect((await urgent.tick()).proposals[0]!.urgency).toBeCloseTo(0.2);
    // Whatever the priority, it is never worth more than instinct's surest choice: full urgency is the reflexes' alone.
    const most = setUp([{ text: "walk", skill: "go_to", doneWhen: "has chest" }], {}, { priority: 1 });
    expect((await most.tick()).proposals[0]!.urgency).toBe(0.8);
  });

  it("a step with no skill becomes the focus of the area below", async () => {
    const m = setUp([{ text: "find a chest", doneWhen: "has chest" }]);
    const { proposals, ports } = await m.tick();
    expect(proposals).toEqual([]);
    expect(ports.feedback).toMatchObject({ goal: { text: "g" }, step: { index: 0, text: "find a chest" } });
    expect(ports.up).toEqual({ step: 0, as: "focus" });
  });

  it("the tick its done-when comes true the step is finished, and the next one is under way", async () => {
    const m = setUp([{ text: "walk", skill: "go_to", doneWhen: "has chest" }, { text: "eat", skill: "eat", doneWhen: "has fed" }, { text: "rest", doneWhen: "has rested" }]);
    expect((await m.tick()).trace.advanced).toBeUndefined();
    const at = Date.now();
    const arrived = await m.tick({ chest: 1 });
    expect(arrived.trace.advanced).toEqual({ step: 0, why: "done when: has chest" });
    expect(m.store.goal()).toMatchObject({ stepsDone: 1, setBy: "prefrontal" });
    expect(m.store.goal()!.stepDoneAt).toBeGreaterThanOrEqual(at);
    // The same tick already proposes the next step's skill.
    expect(arrived.proposals.map((p) => p.action)).toEqual([{ skill: "eat" }]);
    // Two conditions true at once: one step a tick.
    const fed = await m.tick({ fed: 1, rested: 1 });
    expect(m.store.goal()!.stepsDone).toBe(2);
    expect(fed.ports.feedback).toMatchObject({ step: { index: 2, text: "rest" } });
    await m.tick({ fed: 1, rested: 1 });
    expect(m.store.goal()!.stepsDone).toBe(3);
    // Nothing left to do: the goal passes down and nothing is proposed.
    expect(await m.tick()).toMatchObject({ proposals: [], ports: { up: { step: null } } });
  });

  it("a step whose done-when is not understood, or missing, is left as words: nothing is proposed or passed on, and the trace says so", async () => {
    const m = setUp([{ text: "walk", skill: "go_to", doneWhen: "when it feels right" }]);
    const { proposals, ports, trace } = await m.tick();
    expect(proposals).toEqual([]);
    expect(trace.unread).toEqual({ doneWhen: "when it feels right" });
    expect(ports).toMatchObject({ up: { step: 0, as: "words" }, feedback: { goal: { text: "g" } } });
    expect(ports.feedback?.step).toBeUndefined();
    const plain = setUp(["walk about"]);
    expect((await plain.tick()).ports).toMatchObject({ up: { step: 0, as: "words" } });
    expect(plain.store.goal()!.stepsDone).toBe(0);
  });

  it("a skill the planner was not shown is not proposed: the step becomes the focus instead", async () => {
    const m = setUp([{ text: "do it", skill: "nonsense", doneWhen: "has chest" }]);
    const { proposals, ports, trace } = await m.tick();
    expect(proposals).toEqual([]);
    expect(trace.skillProblem).toBe("nonsense: not one of the listed abilities");
    expect(ports.feedback).toMatchObject({ step: { index: 0 } });
  });

  it("stuck when its give-up-when is true", async () => {
    const m = setUp([{ text: "walk", skill: "go_to", doneWhen: "has chest", giveUpWhen: "has night" }]);
    expect((await m.tick()).ports.up).toEqual({ step: 0, as: "skill" });
    const { ports, trace } = await m.tick({ night: 1 });
    expect(trace.stuck).toEqual({ step: 0, why: "give up when: has night" });
    expect(ports.up).toMatchObject({ stuck: { step: 0, text: "walk", why: "give up when: has night", at: m.now() } });
  });

  it("stuck when its skill has failed three times", async () => {
    const m = setUp([{ text: "walk", skill: "go_to", doneWhen: "has chest" }]);
    await m.tick();
    for (const reason of ["no path", "no path"]) {
      m.event("go_to", "failed", reason);
      m.event("eat", "failed");
      expect((await m.tick()).ports.up).toEqual({ step: 0, as: "skill" });
    }
    m.event("go_to", "failed", "blocked");
    expect((await m.tick()).ports.up).toMatchObject({ stuck: { why: "go_to failed 3 times (blocked)" } });
  });

  it("stuck when its skill has run three times its usual time, counted from when it started", async () => {
    const m = setUp([{ text: "walk", skill: "go_to", doneWhen: "has chest" }], { usualMs: () => 2000 });
    await m.tick();
    await m.tick({}, 3000);
    m.run("go_to");
    expect((await m.tick({}, 5900)).ports.up).toEqual({ step: 0, as: "skill" });
    expect((await m.tick({}, 200)).ports.up).toMatchObject({ stuck: { why: "go_to has run 6 s, over 3 times its usual 2 s" } });
  });

  it("a skill that only rests is not judged by time while it runs, however long the wait; any other is, at 30 s while nothing is learned", async () => {
    const m = setUp([{ text: "wait", skill: "idle", doneWhen: "has night" }], { rests: (skill) => skill === "idle" });
    await m.tick();
    m.run("idle");
    expect((await m.tick({}, 3_600_000)).ports.up).toEqual({ step: 0, as: "skill" });
    const walk = setUp([{ text: "walk", skill: "go_to", doneWhen: "has chest" }], { rests: (skill) => skill === "idle" });
    await walk.tick();
    walk.run("go_to");
    expect((await walk.tick({}, 3 * UNLEARNED_MS - 1000)).ports.up).toEqual({ step: 0, as: "skill" });
    expect((await walk.tick({}, 2000)).ports.up).toMatchObject({ stuck: { why: "go_to has run 91 s, over 3 times its usual 30 s" } });
  });

  it("stuck when its skill has not got to run at all for three times its usual time (30 s while none is learned)", async () => {
    const m = setUp([{ text: "walk", skill: "go_to", doneWhen: "has chest" }], { canStart: () => false });
    await m.tick();
    expect((await m.tick({}, 3 * UNLEARNED_MS - 1000)).ports.up).toEqual({ step: 0, as: "skill" });
    expect((await m.tick({}, 2000)).ports.up).toMatchObject({ stuck: { step: 0, why: "go_to has not got to run for 91 s" } });
    // A run that ended a moment ago starts that clock again.
    const ended = setUp([{ text: "walk", skill: "go_to", doneWhen: "has chest" }], { usualMs: () => 2000 });
    await ended.tick();
    await ended.tick({}, 5000);
    ended.event("go_to", "done");
    expect((await ended.tick({}, 5000)).ports.up).toEqual({ step: 0, as: "skill" });
    expect((await ended.tick({}, 1500)).ports.up).toMatchObject({ stuck: { why: "go_to has not got to run for 6 s" } });
  });

  it("a stuck step is reported for as long as it is the step under way: a plan that leaves it as it was is no answer", async () => {
    const step = { text: "walk", skill: "go_to", doneWhen: "has chest", giveUpWhen: "has night" };
    const m = setUp([step]);
    await m.tick();
    const first = (await m.tick({ night: 1 })).ports.up as { stuck: { at: number } };
    // Still proposing, still reporting the same thing.
    const next = await m.tick();
    expect(next.proposals).toHaveLength(1);
    expect(next.ports.up).toMatchObject({ stuck: { at: first.stuck.at } });
    // The same step planned again (a plan that was already on its way, say): the report stands, as it was.
    m.store.viewFor("prefrontal").setGoal({ text: "g again", steps: [step], reason: "" });
    expect((await m.tick()).ports.up).toMatchObject({ stuck: { at: first.stuck.at } });
    // A plan that changes the step is the answer.
    m.store.viewFor("prefrontal").setGoal({ text: "g", steps: [{ ...step, target: "pos:1,2,3" }], reason: "" });
    expect((await m.tick()).ports.up).toEqual({ step: 0, as: "skill" });
  });

  it("a step that goes on being stuck is reported once, and again only half a minute later", async () => {
    const m = setUp([{ text: "walk", skill: "go_to", doneWhen: "has chest", giveUpWhen: "has night" }]);
    await m.tick();
    const first = (await m.tick({ night: 1 })).ports.up as { stuck: { at: number } };
    // Its give-up-when stays true, and its skill fails again and again: still the one report.
    for (let i = 0; i < 20; i++) {
      m.event("go_to", "failed", "no path");
      const next = await m.tick({ night: 1 }, 1000);
      expect(next.trace.stuck).toBeUndefined();
      expect(next.ports.up).toMatchObject({ stuck: { at: first.stuck.at } });
    }
    const again = await m.tick({ night: 1 }, 10_000);
    expect(again.trace.stuck).toBeDefined();
    expect((again.ports.up as { stuck: { at: number } }).stuck.at).toBe(first.stuck.at + 30_000);
  });

  it("proposes nothing for a skill that cannot start, or while the goal counts for nothing", async () => {
    const step = { text: "walk", skill: "go_to", doneWhen: "has chest" };
    expect((await setUp([step], { canStart: () => false }).tick()).trace.cannotStart).toBe("go_to");
    expect((await setUp([step], { canStart: () => false }).tick()).proposals).toEqual([]);
    expect((await setUp([step], { weightOf: () => 0 }).tick()).proposals).toEqual([]);
  });

  it("off, asleep or with no goal it says nothing, so the goal passes straight through to the area below", async () => {
    const step = { text: "walk", skill: "go_to", doneWhen: "has chest" };
    for (const more of [{ strength: 0 }, { paused: () => true }]) {
      const m = setUp([step], more);
      const { proposals, ports } = await m.tick({ chest: 1 });
      expect(proposals).toEqual([]);
      expect(ports).toMatchObject({ up: null, feedback: null });
      expect(m.store.goal()!.stepsDone).toBe(0);
    }
  });

  it("takes far under a millisecond a tick", async () => {
    const m = setUp([{ text: "walk", skill: "go_to", doneWhen: "not has chest", giveUpWhen: "has night" }, { text: "rest", doneWhen: "has rested" }]);
    await m.tick({ chest: 1 });
    const started = performance.now();
    for (let i = 0; i < 2000; i++) await m.tick({ chest: 1 }, 1);
    expect((performance.now() - started) / 2000).toBeLessThan(0.5);
  });
});
