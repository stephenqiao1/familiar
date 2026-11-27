import { describe, expect, it } from "vitest";
import type { State, Workspace } from "@familiar/contracts";
import type { Surprise } from "@familiar/region-sensory";
import { surpriseKept } from "./surprise.js";

const state = {} as State;
const ws = {} as Workspace;
const missing: Surprise = { what: "missing", kind: "chest", ids: [], size: 0.78, why: "no chest here, where there usually is one", at: 1000 };

describe("the hippocampus's reader of a surprise", () => {
  it("keeps a strong surprise as a discovery, once, and a later one anew", () => {
    let strong: Surprise | null = missing;
    const trigger = surpriseKept(() => strong);
    const check = () => trigger.check({ before: state, after: state, events: [], ws });
    expect(check()).toEqual({ kind: "discovery", summary: "Was surprised: No chest here, where there usually is one", involved: ["chest"], outcome: { feeling: "neutral", value: 0 } });
    expect(check()).toBeNull();
    strong = null;
    expect(check()).toBeNull();
    strong = { ...missing, at: 9000 };
    expect(check()).not.toBeNull();
    strong = { what: "expectation", kind: "sees chest", ids: [], size: 1, why: 'expected "sees chest", and it is not so', at: 9500 };
    expect(check()).toMatchObject({ involved: [], summary: 'Was surprised: Expected "sees chest", and it is not so' });
  });
});
