import type { Skill } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { createMemory } from "@familiar/memory";
import { describe, expect, it } from "vitest";
import { fakeState, type StatePatch } from "../encode/state.test-helper.js";
import { asleep, darkness, moved, nightOrEnclosed, noisy, task, unfamiliarPlace, watchedThings } from "./focus.js";

function workspace(patch: StatePatch = {}, running?: string) {
  const store = createWorkspace();
  store.update(fakeState(patch), running ? { skill: running, target: undefined, startedAt: 0 } : null);
  return store;
}
const skill = (name: string, demanding = false): Skill<null> => ({ name, description: "", demanding, canRun: () => true, run: async () => ({ status: "done" }) });

describe("player focus inputs", () => {
  it("darkness rises as the light falls", () => {
    expect(darkness.read(workspace().viewFor("a"), 0)).toBe(0);
    expect(darkness.read(workspace({ time: { lightLevel: 0 } }).viewFor("a"), 0)).toBe(1);
  });

  it("night and closed-in spaces each add", () => {
    const read = (patch: StatePatch) => nightOrEnclosed.read(workspace(patch).viewFor("a"), 0);
    expect(read({})).toBe(0);
    expect(read({ time: { isNight: true } })).toBe(0.5);
    expect(read({ time: { isNight: true }, self: { enclosed: true } })).toBe(1);
  });

  it("an unfamiliar place raises focus; a well-known one lowers it", () => {
    const memory = createMemory();
    const input = unfamiliarPlace(memory);
    const ws = workspace().viewFor("a");
    expect(input.read(ws, 0)).toBe(1);
    const here = { x: 0, y: 63, z: 0, dimension: "overworld" };
    for (let i = 0; i < 5; i++) memory.record({ kind: "reward", place: { ...here, x: i * 2 }, summary: "", involved: [`thing${i}`], outcome: { feeling: "good", value: 1 } }, i * 100_000);
    expect(input.read(ws, 500_000)).toBe(-1);
    // Looking does not count as recalling.
    expect(memory.entries().memories[0]!.strength).toBe(0.3);
  });

  it("noisy: two medium surprises within two minutes raise focus; big or small ones do not count", () => {
    const store = workspace();
    const input = noisy();
    const feel = async (surprise: number, seconds: number) => {
      await new Promise((resolve) => setTimeout(resolve, 2)); // signals are told apart by when they were set
      store.viewFor("dopamine").setSignal("surprise", surprise);
      return input.read(store.viewFor("a"), seconds * 1000);
    };
    return (async () => {
      expect(await feel(0.4, 0)).toBe(0);
      expect(await feel(0.9, 10)).toBe(0);
      expect(await feel(0.5, 20)).toBe(1);
      expect(await feel(0, 200)).toBe(0); // they have aged out
    })();
  });

  it("task: a demanding skill raises focus; rest or nothing lowers it", () => {
    const input = task([skill("attack", true), skill("go_to")]);
    expect(input.read(workspace({}, "attack").viewFor("a"), 0)).toBe(1);
    expect(input.read(workspace({}, "go_to").viewFor("a"), 0)).toBe(0);
    expect(input.read(workspace({}, "idle").viewFor("a"), 0)).toBe(-1);
    expect(input.read(workspace().viewFor("a"), 0)).toBe(-1);
  });
});

describe("focus helpers", () => {
  it("knows when the bot is asleep, and when it moved", () => {
    expect(asleep(workspace({ self: { asleep: true } }).viewFor("a"))).toBe(true);
    expect(asleep(workspace({}, "sleep").viewFor("a"))).toBe(false); // walking to bed is not sleeping
    expect(moved(fakeState(), fakeState({ self: { position: { x: 1, y: 63, z: 0 } } }))).toBe(true);
    expect(moved(fakeState(), fakeState())).toBe(false);
  });

  it("picks out the things in view that the goal asked to watch for", () => {
    const chest = { id: "pos:3,63,0", type: "chest", dist: 3 };
    const cow = { id: "entity:2", type: "cow", dist: 5, hostile: false, reachable: true };
    const store = workspace({ nearby: { blocks: [chest], mobs: [cow] } });
    expect(watchedThings(store.viewFor("a"))).toEqual([]);
    store.viewFor("prefrontal").setGoal({ text: "", steps: [], reason: "", watchFor: ["chest"] });
    expect(watchedThings(store.viewFor("a"))).toEqual([{ id: "pos:3,63,0", kind: "chest", fixed: true }]);
  });
});
