import { describe, expect, it } from "vitest";
import { createDefenceState, MAX_ANALGESIA } from "./defence-state.js";

const flee = { mode: "flee" as const, threat: 0.8 };
const none = { mode: "none" as const, threat: 0 };

describe("analgesia", () => {
  it("rises toward 0.7 while fleeing or fighting, and fades over about 10 seconds after", () => {
    const state = createDefenceState();
    state.step(flee, 1, 0);
    expect(state.step(flee, 1, 1000).analgesia).toBeGreaterThan(0.4);
    const peak = state.step({ mode: "fight", threat: 1 }, 1, 5000).analgesia;
    expect(peak).toBeGreaterThan(0.65);
    expect(peak).toBeLessThanOrEqual(MAX_ANALGESIA);
    expect(state.step(none, 1, 8000).analgesia).toBeGreaterThan(0.2);
    expect(state.step(none, 1, 15_000).analgesia).toBeLessThan(0.05);
  });
  it("keeps building while a flight is still under way, though the threat has dropped behind", () => {
    const state = createDefenceState();
    state.step(flee, 1, 0);
    state.step({ mode: "wary", threat: 0.5 }, 1, 1000, true);
    expect(state.step({ mode: "wary", threat: 0.5 }, 1, 3000, true)).toMatchObject({ active: true, recovering: false });
    expect(state.step({ mode: "wary", threat: 0.5 }, 1, 3000, true).analgesia).toBeGreaterThan(0.6);
  });
  it("stays at 0 for the passive modes, and with the strength at 0", () => {
    const state = createDefenceState();
    state.step({ mode: "freeze", threat: 0.5 }, 1, 0);
    expect(state.step({ mode: "freeze", threat: 0.5 }, 1, 3000).analgesia).toBe(0);
    const off = createDefenceState({ analgesia: 0, recuperate: 1 });
    off.step(flee, 1, 0);
    expect(off.step(flee, 1, 3000).analgesia).toBe(0);
  });
});

describe("recovering", () => {
  it("starts when hurt and clear after a flight, and ends once mended", () => {
    const state = createDefenceState();
    expect(state.step(flee, 0.4, 0).recovering).toBe(false);
    expect(state.step(none, 0.4, 1000).recovering).toBe(true);
    expect(state.step(none, 0.6, 5000).recovering).toBe(true);
    expect(state.step(none, 0.8, 9000).recovering).toBe(false);
  });
  it("ends when a threat returns, and comes back when it has gone", () => {
    const state = createDefenceState();
    state.step(flee, 0.3, 0);
    expect(state.step(none, 0.3, 1000).recovering).toBe(true);
    expect(state.step(flee, 0.3, 2000).recovering).toBe(false);
    expect(state.step({ mode: "wary", threat: 0.5 }, 0.3, 3000).recovering).toBe(true);
  });
  it("does not start for a hurt with no fight or flight before it, or when switched off", () => {
    expect(createDefenceState().step(none, 0.2, 0).recovering).toBe(false);
    const off = createDefenceState({ analgesia: 1, recuperate: 0 });
    off.step(flee, 0.3, 0);
    expect(off.step(none, 0.3, 1000).recovering).toBe(false);
  });
});
