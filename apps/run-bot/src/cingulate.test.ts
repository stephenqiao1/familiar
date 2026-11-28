import type { Planner, Trouble, Workspace } from "@familiar/contracts";
import { createScorebook } from "@familiar/neuromodulators";
import { describe, expect, it } from "vitest";
import { createCallCounter, playerCingulate, troubleNote } from "./cingulate.js";

const ws = (over: Partial<Workspace>): Workspace => ({ signals: {}, current: null, goal: null, needs: null, feeling: null, trouble: null, state: { schemaVersion: 1, tick: 0, timestamp: 0, data: {} }, ...over }) as unknown as Workspace;
const trouble = (events: Trouble["events"]): Trouble => ({ level: 1, events, control: 0.9, verdict: "try harder", leave: 0, changeable: 0 });
const none = { stuckStep: () => null, surprises: () => [] };

describe("what the planner is told when trouble wakes it", () => {
  it("names every face of the event, the strongest event first", () => {
    const note = troubleNote(ws({ trouble: trouble([{ kinds: ["pain", "uneasy"], about: ["body"], strength: 1, age: 0 }, { kinds: ["conflict"], about: [], strength: 0.4, age: 0 }]) }), none);
    expect(note).toBe("There is trouble: pain and the body changed with no cause to be seen; also two choices nearly tied. Plan with that in mind.");
  });

  it("for a stuck step it says which step and why, in the motor area's words, and asks for another way", () => {
    const note = troubleNote(ws({ trouble: trouble([{ kinds: ["stuck step"], about: ["go_to"], strength: 1, age: 0 }]) }), { ...none, stuckStep: () => ({ text: "reach the tree", why: "go_to failed three times" }) });
    expect(note).toBe('There is trouble: a stuck step. The current step ("reach the tree") is stuck: go_to failed three times. Plan another way.');
  });

  it("for a surprise it says what was not as expected", () => {
    const surprise = { kind: "chest", ids: [], why: "no chest at the base, where there usually is one", strength: 1, at: 0 };
    const note = troubleNote(ws({ trouble: trouble([{ kinds: ["unexpected"], about: ["chest"], strength: 1, age: 0 }]) }), { ...none, surprises: () => [surprise] as never });
    expect(note).toContain("Not as expected: no chest at the base, where there usually is one.");
  });
});

describe("what is at stake, for the player", () => {
  const parts = playerCingulate({ scorebook: createScorebook(), skills: [], situationOf: () => "day", stuckStep: () => null, surprises: () => [], amygdalaSurprise: () => 0, placeOf: () => null, calls: createCallCounter() });
  const need = (pressing: number, weight: number) => ({ name: "n", kind: "k", level: pressing, rank: 0, weight, pressing, projected: pressing, tuned: pressing });

  it("a need counts by the weight the hypothalamus gives it: fully short of torches is a quarter of fully hungry", () => {
    expect(parts.stake(ws({ needs: { readings: [need(1, 0.25)] } as never })).need).toBe(0.25);
    expect(parts.stake(ws({ needs: { readings: [need(1, 0.25), need(0.6, 1)] } as never })).need).toBe(0.6);
    // A weight above 1 (danger) does not take it past the need's own level.
    expect(parts.stake(ws({ needs: { readings: [need(0.7, 2)] } as never })).need).toBe(0.7);
  });
});

describe("what counts as an activity, for stay or leave", () => {
  const make = (resting: boolean) => playerCingulate({ scorebook: createScorebook(), skills: [{ name: "sleep", parts: ["legs"] }, { name: "idle", parts: [] }] as never, situationOf: () => "day", stuckStep: () => null, surprises: () => [], amygdalaSurprise: () => 0, placeOf: () => null, resting: () => resting, calls: createCallCounter() });
  const running = (skill: string) => ws({ current: { skill } as never });

  it("rest is not judged for what it pays: asleep, or a skill that uses no part of the body", () => {
    expect(make(false).activity(running("sleep"))).toBe("sleep");
    expect(make(true).activity(running("sleep"))).toBeNull();
    expect(make(false).activity(running("idle"))).toBeNull();
  });
});

describe("the count of thinking spent", () => {
  it("counts the calls of the last minute: one for the engine, fifteen for a plan", async () => {
    const calls = createCallCounter();
    const planner = calls.planner({ name: "p", plan: async () => ({ goal: "", steps: [], reason: "" }) } as Planner);
    calls.spent(0);
    await planner.plan({ situation: "", currentGoal: null }, new AbortController().signal);
    expect(calls.spent(30_000)).toBe(15);
    expect(calls.spent(61_000)).toBe(0);
  });
});
