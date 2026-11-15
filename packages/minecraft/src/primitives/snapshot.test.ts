import { describe, expect, it } from "vitest";
import { asExpected } from "./expect.js";
import { changesBetween, type Snapshot } from "./snapshot.js";

const still: Snapshot = { position: { x: 0, y: 63, z: 0 }, yaw: 0, pitch: 0, items: { bread: 2 }, held: "bread", health: 20, food: 15, sneaking: false, window: null };
const after = (over: Partial<Snapshot>): Snapshot => ({ ...still, ...over });

describe("changesBetween", () => {
  it("reports nothing when nothing changed", () => {
    expect(changesBetween(still, after({}))).toEqual({});
    // Jitter below the thresholds is not change.
    expect(changesBetween(still, after({ position: { x: 0.05, y: 63, z: 0 }, yaw: 0.01 }))).toEqual({});
  });

  it("reports moving and turning", () => {
    expect(changesBetween(still, after({ position: { x: 1.2, y: 63, z: 0 } }))).toEqual({ moved: 1.2 });
    expect(changesBetween(still, after({ yaw: Math.PI / 4 }))).toEqual({ turned: 45 });
    expect(changesBetween(still, after({ pitch: -Math.PI / 6 }))).toEqual({ turned: 30 });
    // A turn across the wrap-around is the short way round.
    expect(changesBetween(after({ yaw: 0.1 }), after({ yaw: 2 * Math.PI - 0.1 }))).toEqual({ turned: 11 });
  });

  it("reports items gained and lost, and a change of what is in hand", () => {
    expect(changesBetween(still, after({ items: { bread: 1, dirt: 3 } }))).toEqual({ gained: { dirt: 3 }, lost: { bread: 1 } });
    expect(changesBetween(still, after({ held: "stone_sword" }))).toEqual({ held: "stone_sword" });
    expect(changesBetween(still, after({ held: null, items: {} }))).toEqual({ lost: { bread: 2 }, held: "nothing" });
  });

  it("reports the target block's type before and after", () => {
    expect(changesBetween(after({ targetBlock: "dirt" }), after({ targetBlock: "air" }))).toEqual({ targetBlockWas: "dirt", targetBlock: "air" });
    expect(changesBetween(after({ targetBlock: "dirt" }), after({ targetBlock: "dirt" }))).toEqual({});
  });

  it("reports health and food changes, and what happened to the target entity", () => {
    expect(changesBetween(still, after({ health: 17, food: 20 }))).toEqual({ health: -3, food: 5 });
    const zombie = (present: boolean, hurts: number) => after({ targetEntity: { present, hurts } });
    expect(changesBetween(zombie(true, 0), zombie(true, 1))).toEqual({ targetHurt: true });
    expect(changesBetween(zombie(true, 0), zombie(false, 1))).toEqual({ targetHurt: true, targetGone: true });
  });

  it("reports items appearing on the ground nearby, or being picked up", () => {
    expect(changesBetween(after({ drops: 0 }), after({ drops: 1 }))).toEqual({ drops: 1 });
    expect(changesBetween(after({ drops: 2 }), after({ drops: 1, items: { bread: 2, stick: 1 } }))).toEqual({ gained: { stick: 1 }, drops: -1 });
  });

  it("reports a container opened or closed, and sneaking", () => {
    expect(changesBetween(still, after({ window: "chest" }))).toEqual({ opened: "chest" });
    expect(changesBetween(after({ window: "chest" }), still)).toEqual({ closed: "chest" });
    expect(changesBetween(still, after({ sneaking: true }))).toEqual({ sneaking: true });
  });
});

describe("asExpected", () => {
  it("is true when every expected change is there, with the expected value if one is given", () => {
    expect(asExpected(["targetBlock=air"], { targetBlockWas: "dirt", targetBlock: "air" })).toBe(true);
    expect(asExpected(["gained", "lost"], { gained: { oak_planks: 4 }, lost: { oak_log: 1 } })).toBe(true);
    expect(asExpected([], {})).toBe(true);
  });

  it("is false when an expected change did not happen", () => {
    expect(asExpected(["targetBlock=air"], {})).toBe(false);
    expect(asExpected(["targetBlock=air"], { targetBlock: "stone" })).toBe(false);
    expect(asExpected(["gained", "lost"], { lost: { oak_log: 1 } })).toBe(false);
  });
});
