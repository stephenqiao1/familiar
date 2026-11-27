import type { SkillEvent } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { describe, expect, it } from "vitest";
import type { MovementNote } from "../movements.js";
import { changeList, keysOf, movementOf, playerMovements } from "./cerebellum.js";

const note = (over: Partial<MovementNote>): MovementNote => ({ kind: "primitive", name: "break_block", status: "done", seconds: 2, at: 1000, facts: {}, ...over });

describe("situation keys, from specific to general", () => {
  it("a movement of the hands: the thing aimed at with the tool, the thing, anything", () => {
    expect(keysOf(note({ parts: ["hands", "head"], facts: { aim: "stone", hand: "wooden_pickaxe", ground: "dirt", surface: "solid" } }))).toEqual(["stone|wooden_pickaxe", "stone", ""]);
    expect(keysOf(note({ parts: ["hands"], facts: { hand: null } }))).toEqual(["bare", ""]);
    expect(keysOf(note({ name: "look_at", parts: ["head"], facts: { aim: "zombie", hand: "bread" } }))).toEqual(["zombie", ""]);
  });

  it("a movement of the legs: the block underfoot, how such a block behaves, anything", () => {
    expect(keysOf(note({ name: "step", parts: ["legs"], facts: { hand: "bread", ground: "soul_sand", surface: "slow", sneaking: true } }))).toEqual(["soul_sand|sneak", "slow|sneak", ""]);
    expect(keysOf(note({ name: "step", parts: ["legs"], facts: { ground: "stone", surface: "solid", body: "slowness" } }))).toEqual(["stone|slowness", "solid|slowness", ""]);
  });

  it("a stretch of travel: gait, ground and slope; the kind of ground; the gait", () => {
    expect(keysOf(note({ kind: "pace", name: "walk", facts: { gait: "jog", ground: "ice", surface: "slippery", slope: "up" } }))).toEqual(["jog|ice|up", "jog|slippery|up", "jog", ""]);
    expect(keysOf(note({ kind: "pace", name: "swim", facts: { gait: "walk", ground: "water", surface: "liquid", inWater: true } }))).toEqual(["walk|water|water", "walk|liquid|water", "walk", ""]);
  });
});

describe("what a movement reports", () => {
  it("lists what it changed in the words the written expectations use, without the bookkeeping", () => {
    expect(changeList({ targetBlock: "air", targetBlockWas: "stone", drops: 1, asExpected: true, targetAt: "1,2,3", progress: 1 })).toEqual(["drops+", "targetBlock", "targetBlock=air"]);
    expect(changeList({ food: 5, lost: { bread: 1 }, health: -2, sneaking: false })).toEqual(["food+", "health-", "lost", "sneaking"]);
  });

  it("gives seconds for one that finished, and distance moved for a movement of the legs", () => {
    expect(movementOf(note({ name: "step", parts: ["legs"], changes: { moved: 0.9 } })).measures).toEqual({ seconds: 2, moved: 0.9 });
    expect(movementOf(note({ name: "step", parts: ["legs"], changes: {} })).measures).toEqual({ seconds: 2, moved: 0 });
    // A journey's time goes by how far it went: only its pace can be compared from one to the next.
    expect(movementOf(note({ kind: "journey", name: "goTo", measures: { secondsPerBlock: 0.2 } })).measures).toEqual({ secondsPerBlock: 0.2 });
    expect(movementOf(note({ status: "failed" })).measures).toEqual({});
  });

  it("a movement stopped from outside, or during which the body was hurt, is cut short", () => {
    expect(movementOf(note({ status: "interrupted" })).cutShort).toBe(true);
    expect(movementOf(note({ hurt: true })).cutShort).toBe(true);
    expect(movementOf(note({})).cutShort).toBeUndefined();
    // The ground already covered still tells the pace.
    expect(movementOf(note({ kind: "pace", status: "interrupted", measures: { secondsPerBlock: 0.2 } }))).toMatchObject({ measures: { secondsPerBlock: 0.2 } });
    expect(movementOf(note({ kind: "pace", status: "interrupted" })).cutShort).toBeUndefined();
  });
});

describe("whole skills, from the events that end them", () => {
  function setup(lastHurtAt: number | null = null) {
    const ws = createWorkspace();
    ws.update({ schemaVersion: 1, tick: 0, timestamp: 0, data: {} }, null);
    const movements = playerMovements({ notes: () => [], lastHurtAt: () => lastHurtAt });
    const run = (...events: SkillEvent[]) => {
      for (const e of events) ws.addEvent(e);
      return movements(ws.viewFor("cerebellum"), 0);
    };
    return run;
  }

  it("times a skill from its start to its end", () => {
    const [m] = setup()({ skill: "eat", type: "started", timestamp: 1000 }, { skill: "eat", type: "done", timestamp: 3500 });
    expect(m).toMatchObject({ kind: "skill", name: "eat", keys: [""], measures: { seconds: 2.5 } });
    expect(m?.cutShort).toBeUndefined();
  });

  it("an interrupted skill, one cut short by a reflex, one given up on and one the body was hurt during teach nothing", () => {
    const end = (over: Partial<SkillEvent>, hurtAt: number | null = null) => setup(hurtAt)({ skill: "go_to", type: "started", timestamp: 1000 }, { skill: "go_to", type: "failed", timestamp: 3000, ...over })[0];
    expect(end({ type: "interrupted" })?.cutShort).toBe(true);
    expect(end({ reason: "cut short by withdraw at 1,2,3" })?.cutShort).toBe(true);
    expect(end({ reason: "gave up after 120 s (patience 0.50, chance 0.50)" })?.cutShort).toBe(true);
    expect(end({ reason: "no path" }, 2000)?.cutShort).toBe(true);
    expect(end({ reason: "no path" })?.cutShort).toBeUndefined();
    expect(end({ reason: "no path" })?.measures).toEqual({});
  });

  it("reads each event once", () => {
    const run = setup();
    expect(run({ skill: "eat", type: "started", timestamp: 1000 }, { skill: "eat", type: "done", timestamp: 3500 })).toHaveLength(1);
    expect(run()).toHaveLength(0);
  });
});
