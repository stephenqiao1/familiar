import { DEFAULT_SELECTION, NO_SELECTION, type SelectionSettings } from "@familiar/basal-ganglia";
import type { Candidate, Skill, State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { createScorebook, DEFAULT_PATIENCE, DEFAULT_PERSONALITY } from "@familiar/neuromodulators";
import { describe, expect, it } from "vitest";
import { createArbiter } from "./brain.js";

// The basal ganglia's new parts as the bot wires them: the real terms, the real channels, the bot's own skills' body parts.

const skill = (name: string, parts?: Skill<null>["parts"], flags: Partial<Skill<null>> = {}): Skill<null> => ({ name, description: name, canRun: () => true, run: async () => ({ status: "done" }), ...(parts ? { parts } : {}), ...flags });
const skills = [skill("idle", []), skill("go_to", ["legs", "hands"]), skill("flee", ["legs", "hands"]), skill("freeze", ["legs", "hands"]), skill("eat", ["hands"]), skill("look_at", ["head"]), skill("sleep"), skill("flinch", [], { reflexOnly: true })];
const cand = (name: string, urgency: number, layer = 1, region = layer === 0 ? "reflex" : "instinct"): Candidate => ({ region, layer, urgency, action: { skill: name }, reason: name });

function choose(candidates: Candidate[], selection: SelectionSettings = DEFAULT_SELECTION, running: string | null = null) {
  const store = createWorkspace();
  store.update({ schemaVersion: 0, tick: 0, timestamp: 1000, data: {} } as State, running ? { skill: running, target: undefined, startedAt: 0 } : null);
  const arbiter = createArbiter({ scorebook: createScorebook(), personality: DEFAULT_PERSONALITY, patience: DEFAULT_PATIENCE, skills, selection });
  const out = arbiter.choose!(candidates, store.viewFor("arbiter"));
  const name = (c: Candidate | null | undefined) => (c && "skill" in c.action ? c.action.skill : null);
  return { won: name(out.winner), beside: out.alongside.map(name), reason: out.winner?.reason ?? "", signals: store.signals() };
}

describe("the basal ganglia's parts as the bot wires them", () => {
  it("body first: the freeze at 0.78 beats Jev's flee at 0.79, and the reason says so", () => {
    const vote = [cand("freeze", 0.78, 0), cand("flee", 0.79)];
    expect(choose(vote, NO_SELECTION).won).toBe("flee");
    expect(choose(vote)).toMatchObject({ won: "freeze", reason: "freeze; decided by body-first" });
  });

  it("body first: idling is a rival to what the body asks, though it uses no body parts; a look is not", () => {
    // Bed at 0.65 against Jev's idle at 0.7: 0.7 × (1 − 0.25 × 0.65) = 0.59.
    expect(choose([cand("sleep", 0.65, 0, "reticular"), cand("idle", 0.7)]).won).toBe("sleep");
    expect(choose([cand("sleep", 0.65, 0, "reticular"), cand("idle", 0.7)], { ...DEFAULT_SELECTION, bodyFirst: 0 }).won).toBe("idle");
    // A weak request still loses: bed at 0.35 against idle at 0.6 (0.6 × 0.9125 = 0.55).
    expect(choose([cand("sleep", 0.35, 0, "reticular"), cand("idle", 0.6)]).won).toBe("idle");
    // A decider's look is no rival to a freeze of the legs: it runs beside it, unscaled.
    expect(choose([cand("freeze", 0.5, 0), cand("look_at", 0.4)])).toMatchObject({ won: "freeze", beside: ["look_at"] });
  });

  it("body first: a habit's proposal is not a request of the body", () => {
    const vote = [cand("go_to", 0.6, 0, "striatum"), cand("eat", 0.7)];
    expect(choose(vote, { ...DEFAULT_SELECTION, wait: 0 }).won).toBe("eat");
  });

  it("channels: a look runs beside a walk and beside idling; a flinch beside anything", () => {
    expect(choose([cand("go_to", 0.6), cand("look_at", 0.4, 0, "colliculus"), cand("flinch", 0.9, 0)])).toMatchObject({ won: "go_to", beside: ["flinch"] });
    expect(choose([cand("idle", 0.9), cand("look_at", 0.35, 0, "colliculus")], DEFAULT_SELECTION, "idle")).toMatchObject({ won: "idle", beside: ["look_at"] });
  });

  it("channels off: one contest, and a look beside a walk only with the same-time rule", () => {
    const off = { ...DEFAULT_SELECTION, channels: 0, wait: 0 };
    expect(choose([cand("go_to", 0.6), cand("look_at", 0.7, 0, "colliculus")], off, "go_to")).toMatchObject({ won: "look_at", beside: [] });
    expect(choose([cand("idle", 0.6), cand("look_at", 0.7, 0, "colliculus")], off, "idle")).toMatchObject({ won: "idle", beside: ["look_at"] });
  });

  it("waiting: a near tie between two deciders' options keeps what is running and shares `conflict`", () => {
    const out = choose([cand("go_to", 0.5), cand("eat", 0.52, 2, "prefrontal")], DEFAULT_SELECTION, "idle");
    expect(out.won).toBeNull();
    expect(out.signals.conflict?.value).toBeCloseTo(0.6);
    expect(choose([cand("go_to", 0.5), cand("eat", 0.52, 2, "prefrontal")], NO_SELECTION, "idle").signals.conflict).toBeUndefined();
  });

  it("full urgency wins at once whatever the parts say", () => {
    expect(choose([cand("freeze", 0.99, 0), cand("flee", 1)])).toMatchObject({ won: "flee" });
  });
});
