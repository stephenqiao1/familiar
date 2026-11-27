import type { Skill, SkillResult } from "@familiar/contracts";
import { describe, expect, it } from "vitest";
import { createChainSkill, parseLearnedSkills, runChain } from "./chain.js";

type Ctx = { ran: string[]; tidied?: boolean };
const never = new AbortController().signal;
const prim = (name: string, result: SkillResult = { status: "done", changes: { did: name } }, over: Partial<Skill<Ctx>> = {}): Skill<Ctx> => ({
  name,
  description: name,
  primitive: true,
  parts: ["hands"],
  canRun: () => true,
  run: async (ctx, target) => (ctx.ran.push(target ? `${name} ${target}` : name), result),
  ...over,
});
const primitives = [prim("turn", undefined, { parts: ["head"] }), prim("step", undefined, { parts: ["legs"] }), prim("break_block", { status: "failed", reason: "too hard" }), prim("stuck", undefined, { canRun: () => false })];

describe("runChain", () => {
  it("runs every step in order and returns each one's result and changes", async () => {
    const ctx: Ctx = { ran: [] };
    const result = await runChain([{ primitive: "turn", target: "dir:left" }, { primitive: "step" }], primitives, ctx, never);
    expect(ctx.ran).toEqual(["turn dir:left", "step"]);
    expect(result).toEqual({
      status: "done",
      steps: [
        { primitive: "turn", target: "dir:left", status: "done", changes: { did: "turn" } },
        { primitive: "step", status: "done", changes: { did: "step" } },
      ],
    });
  });

  it("stops at the first failed step and says where", async () => {
    const ctx: Ctx = { ran: [] };
    const result = await runChain([{ primitive: "turn" }, { primitive: "break_block" }, { primitive: "step" }], primitives, ctx, never);
    expect(ctx.ran).toEqual(["turn", "break_block"]);
    expect(result).toMatchObject({ status: "failed", reason: "step 2 (break_block) failed: too hard", stoppedAt: 1 });
    expect(result.steps).toHaveLength(2);
  });

  it("stops at a step that cannot run, or names something that is not a primitive", async () => {
    expect(await runChain([{ primitive: "stuck" }], primitives, { ran: [] }, never)).toMatchObject({ status: "failed", reason: "step 1 (stuck) failed: cannot run", stoppedAt: 0 });
    expect(await runChain([{ primitive: "fly" }], primitives, { ran: [] }, never)).toMatchObject({ status: "failed", reason: "step 1 (fly) failed: unknown primitive" });
  });

  it("stops cleanly between steps when told to", async () => {
    const ctx: Ctx = { ran: [] };
    const controller = new AbortController();
    const stopper = prim("stopper", undefined, { run: async () => (controller.abort(), { status: "done" }) });
    const result = await runChain([{ primitive: "stopper" }, { primitive: "step" }], [...primitives, stopper], ctx, controller.signal);
    expect(ctx.ran).toEqual([]);
    expect(result).toMatchObject({ status: "interrupted", stoppedAt: 1 });
  });
});

describe("learned skills", () => {
  const json = [{ name: "peek_left", description: "Turn left and step.", steps: [{ primitive: "turn", target: "dir:left" }, { primitive: "step" }] }];

  it("a learned skill loaded from JSON runs its steps, tidies up, and reports each step", async () => {
    const { skills, problems } = parseLearnedSkills(JSON.parse(JSON.stringify(json)), primitives.map((p) => p.name));
    expect(problems).toEqual([]);
    const skill = createChainSkill(skills[0]!, primitives, (ctx) => void (ctx.tidied = true));
    expect(skill).toMatchObject({ name: "peek_left", description: "Turn left and step.", parts: ["head", "legs"] });
    expect(skill.primitive).toBeUndefined(); // a learned skill is a skill, on the menu like any other
    const ctx: Ctx = { ran: [] };
    expect(skill.canRun(ctx)).toBe(true);
    const result = await skill.run(ctx, undefined, never);
    expect(ctx).toEqual({ ran: ["turn dir:left", "step"], tidied: true });
    expect(result.status).toBe("done");
    expect(result.changes?.steps).toHaveLength(2);
  });

  it("a learned skill that fails part-way says which step, and still tidies up", async () => {
    const skill = createChainSkill({ name: "dig", description: "", steps: [{ primitive: "turn" }, { primitive: "break_block" }] }, primitives, (ctx) => void (ctx.tidied = true));
    const ctx: Ctx = { ran: [] };
    expect(await skill.run(ctx, undefined, never)).toMatchObject({ status: "failed", reason: "step 2 (break_block) failed: too hard", changes: { stoppedAt: 1 } });
    expect(ctx.tidied).toBe(true);
  });

  it("can start only when its first step can", () => {
    const skill = createChainSkill({ name: "s", description: "", steps: [{ primitive: "stuck" }, { primitive: "step" }] }, primitives);
    expect(skill.canRun({ ran: [] })).toBe(false);
  });

  it("a missing or empty file means no learned skills", () => {
    expect(parseLearnedSkills(null, ["turn"])).toEqual({ skills: [], retired: [], problems: [] });
    expect(parseLearnedSkills([], ["turn"])).toEqual({ skills: [], retired: [], problems: [] });
  });

  it("leaves out anything malformed and says why: learned skills are data, never code", () => {
    const { skills, problems } = parseLearnedSkills(
      [
        { name: "ok", steps: [{ primitive: "turn" }] },
        { name: "Bad Name", steps: [{ primitive: "turn" }] },
        { name: "go_to", steps: [{ primitive: "turn" }] },
        { name: "empty", steps: [] },
        { name: "calls_a_skill", steps: [{ primitive: "go_to" }] },
        { name: "code", steps: [{ primitive: "turn", target: { run: "rm -rf" } }] },
        { name: "ok", steps: [{ primitive: "turn" }] },
        "nonsense",
      ],
      ["turn", "step"],
      ["go_to"],
    );
    expect(skills).toEqual([{ name: "ok", description: "ok", steps: [{ primitive: "turn" }] }]);
    expect(problems).toHaveLength(7);
    expect(parseLearnedSkills({ not: "a list" }, [])).toEqual({ skills: [], retired: [], problems: ["learned skills must be a list"] });
  });

  it("reads a learned skill's test of success and its failures, and keeps a retired one apart", () => {
    const raw = [
      { name: "fetch", description: "d", steps: [{ primitive: "turn" }], doneWhen: "carrying 1 bread", fails: 2 },
      { name: "old", description: "d", steps: [{ primitive: "turn" }], retired: true, fails: 3 },
      { name: "old", description: "again", steps: [{ primitive: "turn" }] },
    ];
    const { skills, retired, problems } = parseLearnedSkills(raw, ["turn"]);
    expect(skills).toEqual([{ name: "fetch", description: "d", steps: [{ primitive: "turn" }], doneWhen: "carrying 1 bread", fails: 2 }]);
    expect(retired).toEqual([{ name: "old", description: "d", steps: [{ primitive: "turn" }], fails: 3, retired: true }]);
    expect(problems).toEqual(['"old": the name is already taken']);
  });

  it("a chain skill aims each step as it comes up: a target written as a kind is turned into what it means now", async () => {
    const ran: string[] = [];
    const ability = (name: string): Skill<null> => ({ name, description: name, canRun: (_ctx, target) => target !== "nearest:nothing", run: async (_ctx, target) => (ran.push(`${name} ${target ?? ""}`.trim()), { status: "done" }) });
    const aim = (_ctx: null, target: string | undefined) => (target === "nearest:chest" ? "pos:1,2,3" : target);
    const fetch = createChainSkill({ name: "fetch", description: "", steps: [{ primitive: "go", target: "nearest:chest" }, { primitive: "take", target: "nearest:chest" }, { primitive: "eat" }] }, [ability("go"), ability("take"), ability("eat")], undefined, { aim });
    expect(fetch.canRun(null)).toBe(true);
    expect(await fetch.run(null, undefined, new AbortController().signal)).toMatchObject({ status: "done" });
    expect(ran).toEqual(["go pos:1,2,3", "take pos:1,2,3", "eat"]);
    const lost = createChainSkill({ name: "lost", description: "", steps: [{ primitive: "go", target: "nearest:nothing" }] }, [ability("go")], undefined, { aim });
    expect(lost.canRun(null)).toBe(false);
  });

  it("a later step that cannot run yet is waited for a little while, and fails only if it still cannot", async () => {
    let ready = false;
    const first: Skill<null> = { name: "take", description: "", canRun: () => true, run: async () => (setTimeout(() => (ready = true), 200), { status: "done" }) };
    const second: Skill<null> = { name: "eat", description: "", canRun: () => ready, run: async () => ({ status: "done" }) };
    const signal = new AbortController().signal;
    const steps = [{ primitive: "take" }, { primitive: "eat" }];
    expect(await runChain(steps, [first, second], null, signal)).toMatchObject({ status: "failed", stoppedAt: 1, reason: "step 2 (eat) failed: cannot run" });
    ready = false;
    expect(await runChain(steps, [first, second], null, signal, { settleMs: 1000 })).toMatchObject({ status: "done" });
    // The first step is never waited for: a chain that cannot begin fails at once.
    ready = false;
    expect(await runChain([{ primitive: "eat" }], [second], null, signal, { settleMs: 1000 })).toMatchObject({ status: "failed", stoppedAt: 0 });
  });
});
