import { describe, expect, it } from "vitest";
import { sizeUp, type ThreatFacts } from "./size-up.js";

const facts = (over: Partial<ThreatFacts> = {}): ThreatFacts => ({ id: "entity:1", kind: "zombie", dist: 6, seen: true, approach: 0, looming: false, facing: false, hurtMsAgo: null, canWalkTo: true, clearLine: true, shoots: false, escapable: true, danger: 0.5, beatable: true, ...over });
const stage = (over: Partial<ThreatFacts>, bravery = 0.5) => sizeUp(facts(over), bravery).stage;

describe("sizeUp", () => {
  it("harm due about now, by learned timing, makes a threat in view that can reach the bot coming", () => {
    expect(stage({ dist: 10 })).toBe("seen");
    expect(stage({ dist: 10, due: true })).toBe("coming");
    expect(stage({ dist: 10, due: true, canWalkTo: false, clearLine: false })).toBe("seen");
    expect(stage({ dist: 10, due: true, seen: false })).toBe("possible");
  });

  it("in view and unaware: seen", () => {
    expect(sizeUp(facts({ dist: 10 }), 0.5)).toMatchObject({ stage: "seen", noticed: false, noticedBy: null });
  });
  it("noticed by coming at the bot, by facing it, or by having hurt it", () => {
    expect(sizeUp(facts({ approach: 2 }), 0.5).noticedBy).toBe("approach");
    expect(sizeUp(facts({ facing: true }), 0.5).noticedBy).toBe("facing");
    expect(sizeUp(facts({ hurtMsAgo: 5000 }), 0.5).noticedBy).toBe("hurt");
    expect(sizeUp(facts({ hurtMsAgo: 20_000 }), 0.5).noticed).toBe(false);
  });
  it("noticed and inside the flight distance: coming; outside it: still only seen", () => {
    expect(stage({ approach: 2, dist: 7 })).toBe("coming");
    expect(stage({ approach: 2, dist: 10 })).toBe("seen");
  });
  it("the flight distance moves with danger and bravery", () => {
    expect(stage({ approach: 2, dist: 10, danger: 1 })).toBe("coming");
    expect(stage({ approach: 2, dist: 7, danger: 0.5 }, 1)).toBe("seen");
    expect(sizeUp(facts({ danger: 1 }), 0.5).flightDistance).toBeCloseTo(12);
  });
  it("looming is coming whatever the distance", () => {
    expect(stage({ looming: true, dist: 20 })).toBe("coming");
  });
  it("within 3 blocks and able to reach, or having just hurt the bot up close: on it", () => {
    expect(stage({ dist: 2 })).toBe("on_it");
    expect(stage({ dist: 4, hurtMsAgo: 500 })).toBe("on_it");
    expect(stage({ dist: 12, hurtMsAgo: 500 })).toBe("coming");
  });
  it("one that cannot reach the bot is never coming or on it, however close", () => {
    expect(sizeUp(facts({ dist: 2, approach: 2, canWalkTo: false }), 0.5)).toMatchObject({ stage: "seen", canReach: false, noticed: true });
  });
  it("a kind that shoots can reach whenever it has a clear line", () => {
    expect(sizeUp(facts({ dist: 7, facing: true, canWalkTo: false, shoots: true }), 0.5)).toMatchObject({ stage: "coming", canReach: true });
    expect(sizeUp(facts({ dist: 7, facing: true, canWalkTo: false, shoots: true, clearLine: false }), 0.5).canReach).toBe(false);
  });
  it("not in view: possible", () => {
    expect(stage({ seen: false, dist: 10 })).toBe("possible");
  });
  it("a threat the bot is fighting has noticed it, and stays on it when knocked back a few blocks", () => {
    expect(sizeUp(facts({ dist: 4, approach: -3 }), 0.5)).toMatchObject({ stage: "seen", noticed: false });
    expect(sizeUp(facts({ dist: 4, approach: -3, engaged: true }), 0.5)).toMatchObject({ stage: "on_it", noticed: true, noticedBy: "struck" });
    expect(sizeUp(facts({ dist: 7, engaged: true }), 0.5).stage).toBe("coming");
  });
  it("noticing does not lapse the moment it stops moving", () => {
    expect(sizeUp(facts({ dist: 6, noticedLately: true }), 0.5)).toMatchObject({ stage: "coming", noticedBy: "lately" });
  });

  it("marks a threat as settling only when it is coming on a guess at its reach alone", () => {
    const coming = { approach: 2, dist: 5, settling: true };
    expect(sizeUp(facts(coming), 0.5)).toMatchObject({ stage: "coming", settling: true });
    // Looming, or having just hurt the bot, is no guess.
    expect(sizeUp(facts({ ...coming, looming: true }), 0.5)).not.toHaveProperty("settling");
    expect(sizeUp(facts({ ...coming, hurtMsAgo: 5000 }), 0.5)).not.toHaveProperty("settling");
    // Not coming, or the answer is in: nothing to wait for.
    expect(sizeUp(facts({ dist: 10, settling: true }), 0.5)).not.toHaveProperty("settling");
    expect(sizeUp(facts({ approach: 2, dist: 5 }), 0.5)).not.toHaveProperty("settling");
  });
});
