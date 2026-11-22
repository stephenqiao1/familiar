import { createWorkspace } from "@familiar/core";
import { describe, expect, it } from "vitest";
import { fakeState } from "../encode/state.test-helper.js";
import { startleOf, threatPresent } from "./alarm.js";

const zombie = (dist: number) => ({ id: "entity:1", type: "zombie", dist, hostile: true, reachable: true });

describe("what the player's alarm reads beside its needs", () => {
  it("the body's startle, at its size, on the tick the brainstem startles", () => {
    const store = createWorkspace();
    const startle = () => startleOf(store.viewFor("noradrenaline"));
    expect(startle()).toBe(0);
    store.viewFor("brainstem").setSignal("startle", 0.5);
    expect(startle()).toBe(0.5);
    store.viewFor("brainstem").setSignal("startle", 0);
    expect(startle()).toBe(0);
  });

  it("a threat is present while a hostile is close", () => {
    expect(threatPresent(fakeState({ nearby: { mobs: [zombie(4)] } }))).toBe(true);
    expect(threatPresent(fakeState({ nearby: { mobs: [zombie(20)] } }))).toBe(false);
    expect(threatPresent({ schemaVersion: 0, tick: 0, timestamp: 0, data: {} })).toBe(false);
  });
});
