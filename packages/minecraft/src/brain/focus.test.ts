import { createWorkspace } from "@familiar/core";
import { createMemory } from "@familiar/memory";
import { describe, expect, it } from "vitest";
import { fakeState, type StatePatch } from "../encode/state.test-helper.js";
import { asleep, moved, playerFocus, unfamiliarPlace, watchedThings } from "./focus.js";

function workspace(patch: StatePatch = {}, running?: string) {
  const store = createWorkspace();
  store.update(fakeState(patch), running ? { skill: running, target: undefined, startedAt: 0 } : null);
  return store;
}

describe("player focus inputs", () => {
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

  it("failing predictions raise focus, holding ones lower it: the surprise of each run that ends is the evidence", async () => {
    const store = workspace();
    const [, surprised] = playerFocus(createMemory());
    const feel = async (surprise: number, seconds: number) => {
      await new Promise((resolve) => setTimeout(resolve, 2)); // signals are told apart by when they were set
      store.viewFor("dopamine").setSignal("surprise", surprise);
      return surprised!.read(store.viewFor("a"), seconds * 1000);
    };
    expect(surprised!.read(store.viewFor("a"), 0)).toBe(0); // no run has ended: no evidence either way
    expect(await feel(0.8, 0)).toBe(1);
    expect(await feel(0.02, 10)).toBeGreaterThan(0); // one run as expected after a bad miss: still wary
    expect(await feel(0.02, 20)).toBeLessThan(0);
    expect(await feel(0.02, 30)).toBeLessThan(-0.5); // they keep holding: assume
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
