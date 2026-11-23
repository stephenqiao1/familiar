import type { Needs, Workspace } from "@familiar/contracts";
import { describe, expect, it } from "vitest";
import { createDriveWatch, stressOnOutlook } from "./drives.js";

const reading = (name: string, level: number, rank = 0, weight = 1) => ({ name, kind: name, level, rank, weight, pressing: level });
const ws = (seconds: number, needs: Needs | null) => ({ needs, state: { timestamp: seconds * 1000 } }) as unknown as Workspace;
const wanting = (kind: string, danger = 0): Needs => ({ readings: [reading(kind, 0.6), reading("danger", danger, 1, 2)], top: { name: kind, kind, score: 0.6, since: 0 } });

describe("createDriveWatch: a new plan when what the body wants changes kind", () => {
  it("says nothing with no hypothalamus, for the first need it sees, or while the kind stays the same", () => {
    const watch = createDriveWatch();
    expect(watch.changed(ws(0, null))).toBe(false);
    expect(watch.changed(ws(1, wanting("hunger")))).toBe(false);
    expect(watch.changed(ws(2, wanting("hunger")))).toBe(false);
  });
  it("says so once when the kind changes, and at most once in 30 seconds", () => {
    const watch = createDriveWatch();
    watch.changed(ws(0, wanting("hunger")));
    expect(watch.changed(ws(40, wanting("rest")))).toBe(true);
    expect(watch.changed(ws(41, wanting("rest")))).toBe(false);
    expect(watch.changed(ws(50, wanting("hunger")))).toBe(false); // too soon after the last
    expect(watch.changed(ws(71, wanting("hunger")))).toBe(true);
  });
  it("leaves danger to alarm: nothing is asked while a threat presses, and the goal's need is remembered across it", () => {
    const watch = createDriveWatch();
    watch.changed(ws(0, wanting("hunger")));
    expect(watch.changed(ws(40, { ...wanting("safety", 0.7) }))).toBe(false);
    expect(watch.changed(ws(80, wanting("hunger")))).toBe(false);
  });
});

describe("stressOnOutlook: stress darkens the outlook by what the needs do not already account for", () => {
  it("is nothing with no stress shared", () => {
    expect(stressOnOutlook([reading("hunger", 0.5)], undefined)).toEqual([]);
  });
  it("is the stress above the danger of the moment: with a threat close it adds nothing, once the threat has gone it counts in full", () => {
    expect(stressOnOutlook([reading("danger", 0.8, 1, 2)], 0.6)).toEqual([{ name: "stress", level: 0, weight: 1 }]);
    expect(stressOnOutlook([reading("danger", 0.2, 1, 2), reading("hunger", 0.9)], 0.6)[0]!.level).toBeCloseTo(0.4);
    expect(stressOnOutlook([reading("danger", 0, 1, 2), reading("hunger", 0.9)], 0.6)[0]!.level).toBeCloseTo(0.6);
    expect(stressOnOutlook([reading("hunger", 0.9)], 0.6, 0)).toEqual([]);
  });
});
