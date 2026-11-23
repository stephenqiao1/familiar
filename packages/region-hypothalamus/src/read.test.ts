import type { State } from "@familiar/contracts";
import { describe, expect, it } from "vitest";
import type { Need } from "./need.js";
import { pressing, readNeeds } from "./read.js";

const state = (data: Record<string, unknown>): State => ({ schemaVersion: 1, tick: 0, timestamp: 0, data });
const from = (name: string, more: Partial<Need> = {}): Need => ({ name, kind: "body", level: (s) => (s.data[name] as number | null | undefined) ?? null, ...more });

describe("readNeeds", () => {
  const needs = [from("hunger"), from("danger", { rank: 1, weighs: "danger" }), from("dark")];

  it("reads every need once: its level, kind, rank and weight, with rank 0 and weight 1 unless said", () => {
    expect(readNeeds(needs, state({ hunger: 0.5, danger: 0, dark: 0.25 }))).toEqual([
      { name: "hunger", kind: "body", level: 0.5, rank: 0, weight: 1, pressing: 0.5 },
      { name: "danger", kind: "body", level: 0, rank: 1, weight: 2, pressing: 0 },
      { name: "dark", kind: "body", level: 0.25, rank: 0, weight: 1, pressing: 0.25 },
    ]);
  });

  it("leaves out a need that does not apply, is not a number, or throws; and keeps levels within 0 to 1", () => {
    const broken: Need = { name: "broken", kind: "body", level: () => { throw new Error("no"); } };
    const read = readNeeds([...needs, broken, from("nan")], state({ hunger: 3, danger: -1, nan: Number.NaN }));
    expect(read.map((r) => [r.name, r.level])).toEqual([["hunger", 1], ["danger", 0]]);
  });
});

describe("pressing", () => {
  const need = (name: string, level: number, rank = 0) => ({ name, level, rank });

  it("each need presses at its level while nothing more vital presses", () => {
    expect(pressing([need("hunger", 0.6), need("danger", 0, 1)]).map((n) => n.pressing)).toEqual([0.6, 0]);
  });

  it("a more vital need pressing at all silences every lesser one; the levels are untouched", () => {
    const read = pressing([need("hunger", 0.6), need("danger", 0.1, 1), need("dark", 1)]);
    expect(read.map((n) => n.pressing)).toEqual([0, 0.1, 0]);
    expect(read.map((n) => n.level)).toEqual([0.6, 0.1, 1]);
  });

  it("needs of the same rank do not silence each other", () => {
    expect(pressing([need("hunger", 0.6), need("dark", 1)]).map((n) => n.pressing)).toEqual([0.6, 1]);
  });
});
