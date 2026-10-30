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

  it("reports a throwing skill as failed and keeps working", async () => {
    const boom: Skill<Ctx> = {
      name: "boom",
      description: "always throws",
      canRun: () => true,
      run: async () => {
        throw new Error("pickaxe broke");
      },
    };
    const walk = pendingSkill("walk");
    const { executor, types } = setup([boom, walk.skill]);

    await executor.start("boom");
    await tick();
    await executor.start("walk");

    expect(types()).toEqual(["boom:started", "boom:failed(pickaxe broke)", "walk:started"]);
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
      description: "needs a pickaxe",
      canRun: (ctx) => ctx.canMine,
      run: async () => ({ status: "done" }),
    };
    const { executor, types } = setup([mine]);

    await executor.start("mine");
    expect(types()).toEqual(["mine:failed(cannot run)"]);
  });
});
