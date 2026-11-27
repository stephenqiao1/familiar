import { describe, expect, it } from "vitest";
import type { Candidate, Workspace } from "@familiar/contracts";
import { restYields } from "./rest-yields.js";

const ws = {} as Workspace;
const candidate = (region: string, skill: string, layer = 1): Candidate => ({ region, layer, action: { skill }, urgency: 0.5, reason: "" });
const term = (strength = 1) => restYields({ strength, step: (c) => c.region === "motor", rests: (c) => c.layer >= 1 && "skill" in c.action && c.action.skill === "idle" });
const [step, idle, eat, reflex] = [candidate("motor", "go_to"), candidate("instinct", "idle"), candidate("instinct", "eat"), candidate("reflex", "idle", 0)];

describe("rest-yields", () => {
  it("takes a decider's rest out of the running while a step of the goal is offered", () => {
    expect(term().amount(idle, ws, [step, idle])).toBe(0);
    expect(term(0.5).amount(idle, ws, [step, idle])).toBe(0.5);
  });

  it("leaves everything else alone: the step itself, another choice, a request of the body, and rest with no step offered", () => {
    expect(term().amount(step, ws, [step, idle])).toBe(1);
    expect(term().amount(eat, ws, [step, eat])).toBe(1);
    expect(term().amount(reflex, ws, [step, reflex])).toBe(1);
    expect(term().amount(idle, ws, [idle, eat])).toBe(1);
    expect(term(0).amount(idle, ws, [step, idle])).toBe(1);
  });

  it("a step that is itself to rest does not turn rest away", () => {
    expect(term().amount(idle, ws, [candidate("motor", "idle"), idle])).toBe(1);
  });
});
