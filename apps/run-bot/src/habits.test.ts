import { createHabits, DEFAULT_SELECTION } from "@familiar/basal-ganglia";
import type { State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { situationOf } from "@familiar/minecraft";
import { MISMATCH_SIGNAL } from "@familiar/region-cerebellum";
import { describe, expect, it } from "vitest";
import { createPlayerStriatum } from "./habits.js";

const state = (timestamp: number): State => ({ schemaVersion: 0, tick: 0, timestamp, data: {} });

/** A bot with a well-worn habit of eating here, asked what its striatum proposes while `mismatch` stands at this level. */
function habitWith(level: number, strength: number) {
  const habits = createHabits();
  for (let i = 0; i < 14; i++) habits.won(situationOf(state(0)), "eat", { urgency: 0.7, drive: null }, 0);
  const striatum = createPlayerStriatum({ habits, selection: DEFAULT_SELECTION, skills: [], mismatch: strength });
  const store = createWorkspace();
  store.update(state(1000), null);
  const view = store.viewFor("striatum");
  if (level > 0) store.viewFor("cerebellum").setSignal(MISMATCH_SIGNAL, level);
  const out = striatum.region.run(view, new AbortController().signal) as { proposals: { action: { skill?: string } }[]; trace?: { why?: string } };
  return { acted: out.proposals.some((p) => p.action.skill === "eat"), why: out.trace?.why };
}

describe("the striatum reads the cerebellum's mismatch", () => {
  it("a habit acts while movements come out as predicted, and after a small mismatch", () => {
    expect(habitWith(0, 1).acted).toBe(true);
    expect(habitWith(0.3, 1).acted).toBe(true);
  });

  it("a habit gives way while a large mismatch stands", () => {
    expect(habitWith(0.8, 1)).toEqual({ acted: false, why: "a movement went wrong" });
  });

  it("at strength 0 the mismatch is not read", () => {
    expect(habitWith(0.8, 0).acted).toBe(true);
  });
});

describe("the striatum reads the cingulate's trouble", () => {
  /** The same well-worn habit, with the cingulate's reading of trouble at this level. */
  function habitInTrouble(level: number, strength: number) {
    const habits = createHabits();
    for (let i = 0; i < 14; i++) habits.won(situationOf(state(0)), "eat", { urgency: 0.7, drive: null }, 0);
    const striatum = createPlayerStriatum({ habits, selection: DEFAULT_SELECTION, skills: [], trouble: strength });
    const store = createWorkspace();
    store.update(state(1000), null);
    store.viewFor("cingulate").setTrouble({ level, events: [], control: 0, verdict: "carry on", leave: 0, changeable: 0 });
    const out = striatum.region.run(store.viewFor("striatum"), new AbortController().signal) as { proposals: { action: { skill?: string } }[]; trace?: { why?: string } };
    return { acted: out.proposals.some((p) => p.action.skill === "eat"), why: out.trace?.why };
  }

  it("a habit gives way when trouble is above a low level, and acts below it", () => {
    expect(habitInTrouble(0.2, 1).acted).toBe(true);
    expect(habitInTrouble(0.3, 1)).toEqual({ acted: false, why: "there is trouble" });
  });

  it("at strength 0 the trouble is not read", () => {
    expect(habitInTrouble(1, 0).acted).toBe(true);
  });
});
