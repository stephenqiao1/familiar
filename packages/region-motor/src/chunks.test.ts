import { describe, expect, it } from "vitest";
import type { GoalOffer, Region, SkillEvent, Step } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { areaRegions, createConditions, type ConditionKind } from "@familiar/neocortex";
import { CHAIN_LENGTH, createChunks, parseChains, tidied, TIMES_TO_CHUNK, type Chain, type Link } from "./chunks.js";
import { createMotorArea, type ChainOptions } from "./motor-area.js";

const fetch: Link[] = [{ skill: "go_to", target: "nearest:chest" }, { skill: "take_items", target: "nearest:chest" }];
const eat: Link = { skill: "eat" };

describe("chunks", () => {
  it("the same chain finishing the same kind of step three times is ready to be a skill, and not before", () => {
    const chunks = createChunks();
    for (let i = 1; i < TIMES_TO_CHUNK; i++) {
      expect(chunks.finished("carrying 1 bread", fetch)).toMatchObject({ seen: i });
      expect(chunks.ready()).toEqual([]);
    }
    chunks.finished("carrying 1 bread", fetch);
    expect(chunks.ready()).toEqual([{ doneWhen: "carrying 1 bread", links: fetch, seen: 3 }]);
  });

  it("another chain, or the same chain finishing another kind of step, is counted apart", () => {
    const chunks = createChunks();
    chunks.finished("carrying 1 bread", fetch);
    chunks.finished("carrying 1 bread", fetch);
    chunks.finished("carrying 1 bread", [...fetch, eat]);
    chunks.finished("carrying 3 bread", fetch);
    chunks.finished("carrying 1 bread", [fetch[1]!, fetch[0]!]);
    expect(chunks.ready()).toEqual([]);
    expect(chunks.entries().map((c) => c.seen)).toEqual([2, 1, 1, 1]);
  });

  it("a skill run again straight away is one link; one ability alone, nothing, or too long a chain is not kept", () => {
    expect(tidied([eat, eat, fetch[0]!, eat, eat])).toEqual([eat, fetch[0], eat]);
    const chunks = createChunks();
    expect(chunks.finished("x", [eat, eat])).toBe("one ability alone is already a skill");
    expect(chunks.finished("x", [])).toBe("nothing a decider chose ran");
    const long = Array.from({ length: CHAIN_LENGTH.most + 1 }, (_, i) => ({ skill: `s${i}` }));
    expect(chunks.finished("x", long)).toBe("longer than 8 links");
    expect(chunks.entries()).toEqual([]);
  });

  it("once made into a skill a chain is no longer waiting, and all of it is saved and loaded", () => {
    const chunks = createChunks();
    for (let i = 0; i < 4; i++) chunks.finished("carrying 1 bread", fetch);
    chunks.made({ doneWhen: "carrying 1 bread", links: fetch }, "fetch_bread");
    expect(chunks.ready()).toEqual([]);
    const loaded = createChunks(JSON.parse(JSON.stringify(chunks.entries())));
    expect(loaded.entries()).toEqual([{ doneWhen: "carrying 1 bread", links: fetch, seen: 4, skill: "fetch_bread" }]);
    expect(loaded.finished("carrying 1 bread", fetch)).toMatchObject({ seen: 5, skill: "fetch_bread" });
    expect(parseChains([{ doneWhen: "x", links: [eat], seen: 3 }, { doneWhen: "x", links: [{ skill: 3 }, eat], seen: 1 }, null, { links: fetch, seen: 1 }])).toEqual([]);
    expect(parseChains("nonsense")).toEqual([]);
  });
});

describe("the motor area noting chains", () => {
  const signal = new AbortController().signal;
  const has: ConditionKind = { form: "has <key>", read: (text) => ((key) => (key ? (ws) => key in ws.state.data : null))(/^has (\w+)$/.exec(text)?.[1]) };
  const conditions = createConditions([has]);

  function setUp(steps: (string | Step)[], chains: Partial<ChainOptions> = {}) {
    const store = createWorkspace();
    const finished: { doneWhen: string; links: Link[] }[] = [];
    const ended: string[] = [];
    const options: ChainOptions = {
      counts: (event) => event.by === "instinct" || event.by === "motor",
      link: (skill, target) => (target?.startsWith("pos:") ? null : { skill, ...(target === undefined ? {} : { target: target.replace(/^entity:\d+$/, "nearest:cow") }) }),
      finished: (doneWhen, links) => (finished.push({ doneWhen, links }), { doneWhen, links, seen: finished.length } satisfies Chain),
      ended: (event) => void ended.push(`${event.skill} ${event.type}`),
      ...chains,
    };
    const [motor] = areaRegions(createMotorArea({ strength: 1, parse: conditions.parse, skillProblem: () => null, canStart: () => true, chains: options }), ["instinct", "motor", "prefrontal"]) as [Region];
    const top = store.viewFor("prefrontal");
    const goal = (offer: Partial<GoalOffer> = {}) => top.setGoal({ text: "g", steps, reason: "", ...offer });
    goal();
    let ms = 1000;
    let running: { skill: string; target: string | undefined; startedAt: number } | null = null;
    const event = (skill: string, type: SkillEvent["type"], by?: string, target?: string) => {
      ms += 10;
      store.addEvent({ skill, type, timestamp: ms, ...(by ? { by } : {}), ...(target ? { target } : {}) });
      running = type === "started" ? { skill, target, startedAt: ms } : null;
    };
    /** A whole run: started and finished. */
    const ran = (skill: string, by?: string, target?: string, how: SkillEvent["type"] = "done") => {
      event(skill, "started", by, target);
      event(skill, how, by, target);
    };
    async function tick(data: Record<string, unknown> = {}) {
      ms += 500;
      store.update({ schemaVersion: 1, tick: 0, timestamp: ms, data }, running);
      top.setCortex("prefrontal", { feedback: { goal: store.goal() } });
      return (await motor.run(store.viewFor("motor"), signal)).trace as Record<string, any>;
    }
    return { store, tick, event, ran, finished, ended, goal };
  }
  const getBread = { text: "get bread", doneWhen: "has bread" };

  it("hands over the runs a decider started, in order, when the step's done-when comes true; what a reflex did is left out", async () => {
    const m = setUp([getBread]);
    await m.tick();
    m.ran("go_to", "instinct", "nearest:chest");
    m.ran("flee", "reflex", "entity:7");
    m.ran("eat", "medulla");
    m.ran("look_at", undefined);
    await m.tick();
    m.ran("take_items", "instinct", "nearest:chest");
    const trace = await m.tick({ bread: 1 });
    expect(m.finished).toEqual([{ doneWhen: "has bread", links: [{ skill: "go_to", target: "nearest:chest" }, { skill: "take_items", target: "nearest:chest" }] }]);
    expect(trace.chain).toMatchObject({ seen: 1 });
  });

  it("the run still under way when the step finishes is its last link; failed and interrupted runs are not links", async () => {
    const m = setUp([getBread]);
    await m.tick();
    m.ran("go_to", "instinct", "entity:12");
    m.ran("take_items", "instinct", undefined, "failed");
    m.ran("idle", "instinct", undefined, "interrupted");
    m.event("take_items", "started", "motor");
    await m.tick({ bread: 1 });
    expect(m.finished[0]!.links).toEqual([{ skill: "go_to", target: "nearest:cow" }, { skill: "take_items" }]);
  });

  it("a chain with a target that cannot be written as a kind is not kept, and the trace says so", async () => {
    const m = setUp([getBread]);
    await m.tick();
    m.ran("go_to", "instinct", "pos:1,2,3");
    m.ran("take_items", "instinct");
    expect((await m.tick({ bread: 1 })).chain).toBe("a target that cannot be written as a kind of thing");
    expect(m.finished).toEqual([]);
  });

  it("each step has a chain of its own: what ran before the step began, or with no step under way, is not part of it", async () => {
    const m = setUp([{ text: "first", doneWhen: "has a" }, getBread]);
    m.ran("idle", "instinct");
    await m.tick();
    m.ran("go_to", "instinct", "nearest:chest");
    await m.tick({ a: 1 });
    m.ran("take_items", "instinct");
    m.ran("eat", "instinct");
    await m.tick({ a: 1, bread: 1 });
    expect(m.finished.map((f) => f.links.map((l) => l.skill))).toEqual([["idle", "go_to"].slice(1), ["take_items", "eat"]]);
    // With the goal finished, runs are still looked at (for judging learned skills) but belong to no chain.
    m.ran("go_to", "instinct", "nearest:chest");
    await m.tick({ a: 1, bread: 1 });
    expect(m.finished).toHaveLength(2);
    expect(m.ended).toEqual(["idle done", "go_to done", "take_items done", "eat done", "go_to done"]);
  });
});
