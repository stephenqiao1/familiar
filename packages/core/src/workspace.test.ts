import { describe, expect, it } from "vitest";
import { createWorkspace } from "./workspace.js";

describe("createWorkspace", () => {
  it("stamps each region's writes with its name", () => {
    const store = createWorkspace();
    store.viewFor("neocortex").setGoal({ text: "find iron", steps: ["dig down"], reason: "need tools" });
    store.viewFor("instinct").setSignal("fear", 0.4);

    const reader = store.viewFor("reflex");
    expect(reader.goal).toMatchObject({ text: "find iron", setBy: "neocortex" });
    expect(reader.signals.fear).toMatchObject({ value: 0.4, source: "instinct" });
  });

  it("clamps signals to 0..1", () => {
    const store = createWorkspace();
    store.viewFor("x").setSignal("a", 3);
    store.viewFor("x").setSignal("b", Number.NaN);
    expect(store.signals().a!.value).toBe(1);
    expect(store.signals().b!.value).toBe(0);
  });

  it("keeps the last 20 skill events", () => {
    const store = createWorkspace();
    for (let i = 0; i < 25; i++) store.addEvent({ skill: `s${i}`, type: "started", timestamp: i });
    const events = store.viewFor("x").recentEvents;
    expect(events).toHaveLength(20);
    expect(events[0]!.skill).toBe("s5");
  });

  it("shows the latest state and running skill", () => {
    const store = createWorkspace();
    store.update({ schemaVersion: 1, tick: 3, timestamp: 0, data: {} }, { skill: "eat", target: undefined, startedAt: 0 });
    const view = store.viewFor("x");
    expect(view.state.tick).toBe(3);
    expect(view.current?.skill).toBe("eat");
  });
});
