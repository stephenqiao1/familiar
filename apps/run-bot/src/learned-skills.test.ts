import { describe, expect, it } from "vitest";
import { createChainSkill, parseLearnedSkills, type LearnedSkill } from "@familiar/core";
import type { Skill } from "@familiar/contracts";
import { createLearnedStore, RETIRE_AFTER, wordOf } from "./learned-skills.js";

const fetch = { doneWhen: "carrying 1 bread", links: [{ skill: "go_to", target: "nearest:chest" }, { skill: "take_items", target: "nearest:chest" }] };
const BUILT_IN = ["go_to", "take_items", "eat", "idle"];
const store = (more: Partial<Parameters<typeof createLearnedStore>[0]> = {}) => createLearnedStore({ builtIn: BUILT_IN, ...more });

describe("the skills the bot saves for itself", () => {
  it("a chain becomes a skill in the format the loader reads, with its done-when as its test", () => {
    const learned: LearnedSkill[] = [];
    const s = store({ onLearn: (skill) => void learned.push(skill) });
    const skill = s.add(fetch, { name: "Fetch-Bread!", description: "Walk to the chest and take what is wanted." });
    expect(skill).toEqual({ name: "fetch_bread", description: "Walk to the chest and take what is wanted.", steps: [{ primitive: "go_to", target: "nearest:chest" }, { primitive: "take_items", target: "nearest:chest" }], doneWhen: "carrying 1 bread" });
    expect(learned).toEqual([skill]);
    // What is written is read back whole by the loader.
    const read = parseLearnedSkills(JSON.parse(JSON.stringify(s.entries())), ["go_to", "take_items", "eat", "idle"]);
    expect(read).toEqual({ skills: [skill], retired: [], problems: [] });
    expect(s.testOf("fetch_bread")).toBe("carrying 1 bread");
    expect(s.testOf("go_to")).toBeNull();
  });

  it("the name is one safe word and never one that is taken; with none given it is made from the links", () => {
    const s = store();
    expect(s.add(fetch, { name: "go_to", description: "" }).name).toBe("go_to_then_take_items");
    expect(s.add(fetch, null)).toMatchObject({ name: "go_to_then_take_items_2", description: "A routine that worked: go_to nearest:chest, then take_items nearest:chest." });
    expect(s.add(fetch, { name: "restock", description: "x" }).name).toBe("restock");
    expect(s.add(fetch, { name: "Restock", description: "x" }).name).toBe("restock_2");
    expect(s.taken()).toEqual([...BUILT_IN, "go_to_then_take_items", "go_to_then_take_items_2", "restock", "restock_2"]);
    expect([wordOf("  Get Bread  "), wordOf("!!!"), wordOf("a".repeat(60)).length]).toEqual(["get_bread", "", 40]);
  });

  it("three failures running retire it: off the list in use, still in the file and marked; a success in between starts the count again", () => {
    const retired: string[] = [];
    const s = store({ onRetire: (skill) => void retired.push(skill.name) });
    s.add(fetch, { name: "fetch", description: "d" });
    expect([s.ran("fetch", false), s.ran("fetch", false), s.ran("fetch", true)]).toEqual([false, false, false]);
    expect(s.skills()[0]!.fails).toBeUndefined();
    for (let i = 1; i < RETIRE_AFTER; i++) expect(s.ran("fetch", false)).toBe(false);
    expect(s.ran("fetch", false)).toBe(true);
    expect(retired).toEqual(["fetch"]);
    expect(s.skills()).toEqual([]);
    expect(s.entries()).toMatchObject([{ name: "fetch", retired: true, fails: 3 }]);
    expect(s.testOf("fetch")).toBeNull();
    // The loader keeps a retired skill apart, and its name stays taken.
    const read = parseLearnedSkills(JSON.parse(JSON.stringify(s.entries())), BUILT_IN);
    expect(read.skills).toEqual([]);
    expect(read.retired).toMatchObject([{ name: "fetch", retired: true }]);
    expect(store({ saved: read }).add(fetch, { name: "fetch", description: "d" }).name).toBe("go_to_then_take_items");
    expect(s.ran("fetch", false)).toBe(false);
  });

  it("a learned skill is only a chain of abilities the bot has, and one risky link makes the whole skill risky", async () => {
    const ran: string[] = [];
    const ability = (name: string, more: Partial<Skill<null>> = {}): Skill<null> => ({ name, description: name, canRun: () => true, run: async (_ctx, target) => (ran.push(`${name} ${target ?? ""}`.trim()), { status: "done" }), ...more });
    const pool = [ability("go_to"), ability("attack", { risky: true }), ability("eat", { parts: ["hands"] })];
    const s = store();
    const hunt = createChainSkill(s.add({ doneWhen: "carrying 1 beef", links: [{ skill: "go_to", target: "nearest:cow" }, { skill: "attack", target: "nearest:cow" }] }, { name: "hunt", description: "d" }), pool);
    expect(hunt.risky).toBe(true);
    expect(await hunt.run(null, undefined, new AbortController().signal)).toMatchObject({ status: "done" });
    expect(ran).toEqual(["go_to nearest:cow", "attack nearest:cow"]);
    // A chain naming something outside what a chain may be made of (a reflex-only skill) is refused by the loader.
    expect(parseLearnedSkills([{ name: "cheat", description: "", steps: [{ primitive: "surface" }] }], ["go_to", "eat"]).problems).toEqual(['"cheat": step {"primitive":"surface"} does not name a primitive']);
  });
});
