import { describe, expect, it } from "vitest";
import type { Goal, IfThen } from "@familiar/contracts";
import { createLoadedResponses } from "./loaded.js";

const goal = (ifThen: IfThen[], setAt = 1): Goal => ({ text: "", steps: [], reason: "", wants: [], watchFor: [], ifThen, holdBack: [], stepsDone: 0, stepDoneAt: null, setBy: "prefrontal", setAt });
const creeper = { id: "entity:1", kind: "creeper" };
const problemWith = (skill: string) => (skill === "flee" || skill === "go_to" ? null : skill === "brace" ? "a primitive, not a skill" : "unknown skill");

describe("createLoadedResponses", () => {
  it("fires when a thing of the loaded kind comes into view, once", () => {
    const loaded = createLoadedResponses(problemWith);
    const g = goal([{ when: "creeper", skill: "flee" }]);
    expect(loaded.observe(g, [], 0).fire).toBeNull();
    expect(loaded.observe(g, [creeper], 1000).fire).toEqual({ rule: { when: "creeper", skill: "flee" }, thing: creeper });
    // Still in view: it has already been answered.
    expect(loaded.observe(g, [creeper], 9000).fire).toBeNull();
  });

  it("stops when the goal changes", () => {
    const loaded = createLoadedResponses(problemWith);
    loaded.observe(goal([{ when: "creeper", skill: "flee" }]), [], 0);
    expect(loaded.observe(goal([], 2), [creeper], 1000).fire).toBeNull();
    expect(loaded.observe(null, [{ id: "entity:2", kind: "creeper" }], 9000).fire).toBeNull();
  });

  it("fires at most once per 3 seconds", () => {
    const loaded = createLoadedResponses(problemWith);
    const g = goal([{ when: "creeper", skill: "flee" }]);
    loaded.observe(g, [], 0);
    expect(loaded.observe(g, [creeper], 1000).fire).not.toBeNull();
    expect(loaded.observe(g, [creeper, { id: "entity:2", kind: "creeper" }], 2000).fire).toBeNull();
    expect(loaded.observe(g, [creeper, { id: "entity:2", kind: "creeper" }, { id: "entity:3", kind: "creeper" }], 4000).fire?.thing.id).toBe("entity:3");
  });

  it("fires for the source of a startle even if it was already in view", () => {
    const loaded = createLoadedResponses(problemWith);
    const g = goal([{ when: "creeper", skill: "flee" }]);
    loaded.observe(g, [creeper], 0);
    loaded.observe(g, [creeper], 5000);
    expect(loaded.observe(g, [creeper], 9000, creeper).fire?.thing).toEqual(creeper);
  });

  it("drops responses that name an unknown skill or a primitive, and says so once per goal", () => {
    const loaded = createLoadedResponses(problemWith);
    const g = goal([{ when: "creeper", skill: "teleport" }, { when: "creeper", skill: "brace" }, { when: "chest", skill: "go_to" }]);
    const first = loaded.observe(g, [creeper], 0);
    expect(first.fire).toBeNull();
    expect(first.dropped).toEqual([
      { rule: { when: "creeper", skill: "teleport" }, why: "unknown skill" },
      { rule: { when: "creeper", skill: "brace" }, why: "a primitive, not a skill" },
    ]);
    expect(loaded.observe(g, [creeper], 500).dropped).toBeUndefined();
    expect(loaded.observe(g, [creeper, { id: "pos:1,2,3", kind: "chest" }], 4000).fire?.rule.skill).toBe("go_to");
  });
});
