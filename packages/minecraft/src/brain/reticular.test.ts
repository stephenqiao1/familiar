import type { Skill } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { describe, expect, it } from "vitest";
import { fakeState, type StatePatch } from "../encode/state.test-helper.js";
import { playerReticular } from "./reticular.js";

const skill = (name: string, flags: Partial<Skill<null>> = {}): Skill<null> => ({ name, description: name, canRun: () => true, run: async () => ({ status: "done" }), ...flags });
const zombie = (dist: number) => ({ id: "entity:1", type: "zombie", dist, hostile: true, reachable: true });
const view = (patch: StatePatch, running: string | null = null) => {
  const store = createWorkspace();
  store.update(fakeState(patch), running ? { skill: running, target: undefined, startedAt: 0 } : null);
  return store.viewFor("reticular");
};

describe("playerReticular", () => {
  const skills = [skill("sleep"), skill("idle"), skill("attack", { risky: true, demanding: true }), skill("go_to")];
  const { moment, bed } = playerReticular(skills, null);

  it("reads the moment: night and how far through it, safe, idle, still, in bed, health", () => {
    expect(moment(view({ time: { isNight: true, nightProgress: 0.8 }, self: { health: 10 } }))).toEqual({ night: true, nightProgress: 0.8, safe: true, idle: true, still: true, asleep: false, demanding: false, risky: false, health: 0.5 });
    expect(moment(view({ self: { asleep: true } }, "sleep"))).toMatchObject({ night: false, asleep: true, idle: true });
    // A state made without a clock is taken as the middle of the night.
    expect(moment(view({ time: { isNight: true } }))?.nightProgress).toBe(0.5);
  });
  it("is not safe with a threat in view, not idle with work under way, not still while travelling", () => {
    expect(moment(view({ nearby: { mobs: [zombie(12)] } }))).toMatchObject({ safe: false });
    expect(moment(view({}, "go_to"))).toMatchObject({ idle: false, demanding: false });
    expect(moment(view({}, "attack"))).toMatchObject({ idle: false, demanding: true, risky: true });
    expect(moment(view({ self: { locomotion: { moving: true, pattern: "walk", gait: "walk", stuck: false } } }))).toMatchObject({ still: false });
  });
  it("is silent before the first Minecraft state", () => {
    expect(moment(createWorkspace().viewFor("reticular"))).toBeNull();
  });
  it("names sleep as the bed skill, and says why it cannot start", () => {
    expect(bed?.skill).toBe("sleep");
    expect(bed?.problem(view({}))).toBeNull();
    const cannot = playerReticular([skill("sleep", { canRun: () => false })], null, () => "no bed in reach");
    expect(cannot.bed?.problem(view({}))).toBe("no bed in reach");
    // Already on its way to bed: nothing is in the way.
    expect(cannot.bed?.problem(view({}, "sleep"))).toBeNull();
    expect(playerReticular([skill("sleep", { canRun: () => false })], null).bed?.problem(view({}))).toBe("sleep is not possible right now");
    expect(playerReticular([skill("idle")], null).bed).toBeUndefined();
  });
});
