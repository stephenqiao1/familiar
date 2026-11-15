import { createWorkspace } from "@familiar/core";
import { describe, expect, it } from "vitest";
import { fakeState } from "../encode/state.test-helper.js";
import { bigSurprise, damage, hostileAppeared, threatPresent } from "./alarm.js";

const ws = createWorkspace().viewFor("noradrenaline");
const zombie = (dist: number) => ({ id: "entity:1", type: "zombie", dist, hostile: true, reachable: true });
const hurt = (from: number, to: number) => damage.check({ before: fakeState({ self: { health: from } }), after: fakeState({ self: { health: to } }), ws });

describe("player alarm triggers", () => {
  it("damage: half a heart is small, a third of health is a full alarm", () => {
    expect(hurt(20, 19)).toBeCloseTo(0.15);
    expect(hurt(20, 13)).toBe(1);
    expect(hurt(10, 14)).toBe(0);
  });

  it("hostile appeared: only when one comes close and none was", () => {
    const check = (before: ReturnType<typeof zombie>[], after: ReturnType<typeof zombie>[]) =>
      hostileAppeared().check({ before: fakeState({ nearby: { mobs: before } }), after: fakeState({ nearby: { mobs: after } }), ws });
    expect(check([], [zombie(5)])).toBe(0.6);
    expect(check([zombie(5)], [zombie(3)])).toBe(0);
    expect(check([], [zombie(20)])).toBe(0);
  });

  it("hostile appeared: the same mob stepping out and back in is not a new threat", () => {
    const trigger = hostileAppeared();
    const at = (seconds: number, mobs: ReturnType<typeof zombie>[]) => fakeState({ nearby: { mobs } }, seconds * 1000);
    expect(trigger.check({ before: at(0, []), after: at(1, [zombie(5)]), ws })).toBe(0.6);
    expect(trigger.check({ before: at(5, []), after: at(6, [zombie(5)]), ws })).toBe(0); // back within 30 s
    expect(trigger.check({ before: at(59, []), after: at(60, [zombie(5)]), ws })).toBe(0.6); // long gone: new again
    expect(trigger.check({ before: at(61, []), after: at(62, [{ ...zombie(5), id: "entity:2" }]), ws })).toBe(0.6); // another mob
  });

  it("big surprise: only a bad surprise big enough to mean the world changed", () => {
    const store = createWorkspace();
    const check = (surprise: number) => {
      store.viewFor("dopamine").setSignal("bad_surprise", surprise);
      return bigSurprise().check({ before: fakeState(), after: fakeState(), ws: store.viewFor("noradrenaline") });
    };
    expect(check(0.4)).toBe(0);
    expect(check(0.8)).toBe(0.4);
  });

  it("big surprise by focus: the same surprise trips alarm at low focus and not at high focus", () => {
    const store = createWorkspace();
    const check = (focus: number, surprise: number) => {
      store.viewFor("acetylcholine").setSignal("focus", focus);
      store.viewFor("dopamine").setSignal("bad_surprise", surprise);
      return bigSurprise(true).check({ before: fakeState(), after: fakeState(), ws: store.viewFor("noradrenaline") });
    };
    expect(check(0.2, 0.5)).toBe(0.25); // calm and familiar: 0.5 is above 0.2 / 0.7
    expect(check(0.9, 0.5)).toBe(0); // known to be chaotic: it would take more than 0.9 / 1.4
    expect(check(0.9, 0.7)).toBe(0.35);
  });

  it("a threat is present while a hostile is close", () => {
    expect(threatPresent(fakeState({ nearby: { mobs: [zombie(4)] } }))).toBe(true);
    expect(threatPresent(fakeState({ nearby: { mobs: [zombie(20)] } }))).toBe(false);
    expect(threatPresent({ schemaVersion: 0, tick: 0, timestamp: 0, data: {} })).toBe(false);
  });
});
