import { afterEach, describe, expect, it, vi } from "vitest";
import type { Skill, SkillEvent, SkillResult } from "@familiar/contracts";
import { createSkillExecutor } from "./skill-executor.js";

type Ctx = { canMine: boolean };

/** A skill that runs until `finish` is called or its signal aborts. */
function pendingSkill(name: string) {
  let finish: (result: SkillResult) => void = () => {};
  const skill: Skill<Ctx> = {
    name,
    description: `${name} until told to stop`,
    canRun: () => true,
    run: (_ctx, _target, signal) =>
      new Promise((resolve) => {
        finish = resolve;
        signal.addEventListener("abort", () => resolve({ status: "interrupted" }));
      }),
  };
  return { skill, finish: (r: SkillResult = { status: "done" }) => finish(r) };
}

function setup(skills: Skill<Ctx>[], defaultTimeoutMs?: number) {
  const events: SkillEvent[] = [];
  const executor = createSkillExecutor({
    skills,
    ctx: { canMine: false },
    onEvent: (e) => events.push(e),
    ...(defaultTimeoutMs === undefined ? {} : { defaultTimeoutMs }),
  });
  const types = () => events.map((e) => `${e.skill}:${e.type}${e.reason ? `(${e.reason})` : ""}`);
  return { executor, events, types };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createSkillExecutor", () => {
  afterEach(() => vi.useRealTimers());

  it("starts a skill and reports done", async () => {
    const walk = pendingSkill("walk");
    const { executor, events, types } = setup([walk.skill]);

    await executor.start("walk", "home");
    expect(executor.current()).toMatchObject({ skill: "walk", target: "home" });

    walk.finish();
    await tick();
    expect(types()).toEqual(["walk:started", "walk:done"]);
    expect(events[0]).toMatchObject({ target: "home", timestamp: expect.any(Number) });
    expect(executor.current()).toBeNull();
  });

  it("interrupts a running skill and waits for it to settle", async () => {
    const walk = pendingSkill("walk");
    const { executor, types } = setup([walk.skill]);

    await executor.start("walk");
    await executor.interrupt();

    expect(types()).toEqual(["walk:started", "walk:interrupted"]);
    expect(executor.current()).toBeNull();
  });

  it("replaces a running skill with a new one", async () => {
    const walk = pendingSkill("walk");
    const dig = pendingSkill("dig");
    const { executor, types } = setup([walk.skill, dig.skill]);

    await executor.start("walk");
    await executor.start("dig", "stone");

    expect(types()).toEqual(["walk:started", "walk:interrupted", "dig:started"]);
    expect(executor.current()).toMatchObject({ skill: "dig", target: "stone" });
  });

  it("ignores a start for the skill and target already running", async () => {
    const walk = pendingSkill("walk");
    const { executor, types } = setup([walk.skill]);

    await executor.start("walk", "home");
    await executor.start("walk", "home");
    expect(types()).toEqual(["walk:started"]);

    await executor.start("walk", "mine");
    expect(types()).toEqual(["walk:started", "walk:interrupted", "walk:started"]);
  });

  it("aborts a skill that runs past its timeout", async () => {
    vi.useFakeTimers();
    const walk = pendingSkill("walk");
    const { executor, types } = setup([walk.skill], 1000);

    await executor.start("walk");
    await vi.advanceTimersByTimeAsync(999);
    expect(types()).toEqual(["walk:started"]);

    await vi.advanceTimersByTimeAsync(1);
    expect(types()).toEqual(["walk:started", "walk:failed(timeout)"]);
    expect(executor.current()).toBeNull();
  });

  it("abandons a running skill as failed with the reason given", async () => {
    const walk = pendingSkill("walk");
    const { executor, types } = setup([walk.skill]);
    await executor.start("walk");
    await executor.abandon("gave up after 90 s");
    expect(types()).toEqual(["walk:started", "walk:failed(gave up after 90 s)"]);
    expect(executor.current()).toBeNull();
    await executor.abandon("nothing running");
    expect(types()).toHaveLength(2);
  });

  it("reports a throwing skill as failed and keeps working", async () => {
    const boom: Skill<Ctx> = {
      name: "boom",
      description: "always throws",
      canRun: () => true,
      run: async () => {
        throw new Error("tool broke");
      },
    };
    const walk = pendingSkill("walk");
    const { executor, types } = setup([boom, walk.skill]);

    await executor.start("boom");
    await tick();
    await executor.start("walk");

    expect(types()).toEqual(["boom:started", "boom:failed(tool broke)", "walk:started"]);
  });

  it("reports an unknown skill as failed without stopping the running one", async () => {
    const walk = pendingSkill("walk");
    const { executor, types } = setup([walk.skill]);

    await executor.start("walk");
    await expect(executor.start("fly")).resolves.toBeUndefined();

    expect(types()).toEqual(["walk:started", "fly:failed(unknown skill)"]);
    expect(executor.current()).toMatchObject({ skill: "walk" });
  });

  it("reports a skill that cannot run as failed", async () => {
    const mine: Skill<Ctx> = {
      name: "mine",
      description: "needs a tool",
      canRun: (ctx) => ctx.canMine,
      run: async () => ({ status: "done" }),
    };
    const { executor, types } = setup([mine]);

    await executor.start("mine");
    expect(types()).toEqual(["mine:failed(cannot run)"]);
  });

  it("passes on what a run says it was aimed at", async () => {
    const fetch: Skill<Ctx> = { name: "fetch", description: "", canRun: () => true, run: async () => ({ status: "done", aimedAt: "pos:1,2,3" }) };
    const { executor, events } = setup([fetch]);
    await executor.start("fetch");
    await tick();
    expect(events.at(-1)).toMatchObject({ skill: "fetch", type: "done", aimedAt: "pos:1,2,3" });
    expect(events[0]).not.toHaveProperty("aimedAt");
  });

  it("passes on what a run changed", async () => {
    const dig: Skill<Ctx> = { name: "dig", description: "", canRun: () => true, run: async () => ({ status: "done", changes: { targetBlock: "air", asExpected: true } }) };
    const { executor, events } = setup([dig]);
    await executor.start("dig");
    await tick();
    expect(events.at(-1)).toMatchObject({ skill: "dig", type: "done", changes: { targetBlock: "air", asExpected: true } });
    expect(events[0]).not.toHaveProperty("changes");
  });

  describe("different body parts at the same time", () => {
    const part = (name: string, parts?: Skill<Ctx>["parts"]) => {
      const pending = pendingSkill(name);
      return { ...pending, skill: { ...pending.skill, ...(parts ? { parts } : {}) } };
    };
    function both(skills: Skill<Ctx>[]) {
      const main: SkillEvent[] = [];
      const side: SkillEvent[] = [];
      const executor = createSkillExecutor({ skills, ctx: { canMine: false }, onEvent: (e) => main.push(e), onSideEvent: (e) => side.push(e) });
      const show = (events: SkillEvent[]) => events.map((e) => `${e.skill}:${e.type}`);
      return { executor, main: () => show(main), side: () => show(side), sideEvents: side };
    }

    it("a head-only movement runs alongside a legs-only one", async () => {
      const [walk, look] = [part("step", ["legs"]), part("look_at", ["head"])];
      const { executor, main, side, sideEvents } = both([walk.skill, look.skill]);
      await executor.start("step");
      await executor.startAlongside("look_at", "entity:1");
      expect(main()).toEqual(["step:started"]);
      expect(side()).toEqual(["look_at:started"]);
      expect(sideEvents[0]).toMatchObject({ alongside: true, target: "entity:1" });
      // The main skill is still the bot's current skill.
      expect(executor.current()).toMatchObject({ skill: "step" });
      look.finish();
      await tick();
      expect(side()).toEqual(["look_at:started", "look_at:done"]);
      expect(main()).toEqual(["step:started"]);
    });

    it("two that share a part do not run together", async () => {
      const [walk, brace, wholeBody] = [part("step", ["legs"]), part("brace", ["legs", "head"]), part("go_to")];
      const { executor, main, side } = both([walk.skill, brace.skill, wholeBody.skill, part("look_at", ["head"]).skill]);
      await executor.start("step");
      await executor.startAlongside("brace");
      expect(side()).toEqual([]);
      // A skill that names no parts uses the whole body, so nothing runs beside it.
      await executor.start("go_to");
      await executor.startAlongside("look_at");
      expect(side()).toEqual([]);
      expect(main()).toEqual(["step:started", "step:interrupted", "go_to:started"]);
    });

    it("the main action always wins: a new main skill that needs the head stops the look", async () => {
      const [eat, look, fight] = [part("eat", ["hands"]), part("look_at", ["head"]), part("attack")];
      const { executor, main, side } = both([eat.skill, look.skill, fight.skill]);
      await executor.start("eat");
      await executor.startAlongside("look_at");
      await executor.start("attack");
      expect(side()).toEqual(["look_at:started", "look_at:interrupted"]);
      expect(main()).toEqual(["eat:started", "eat:interrupted", "attack:started"]);
    });

    it("interrupt stops both", async () => {
      const [eat, look] = [part("eat", ["hands"]), part("look_at", ["head"])];
      const { executor, main, side } = both([eat.skill, look.skill]);
      await executor.start("eat");
      await executor.startAlongside("look_at");
      await executor.interrupt();
      expect([main().at(-1), side().at(-1)]).toEqual(["eat:interrupted", "look_at:interrupted"]);
    });
  });
});
