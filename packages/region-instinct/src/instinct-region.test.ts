import { describe, expect, it } from "vitest";
import type { Answer, DecisionEngine, Question } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { EchoEngine } from "@familiar/engine-echo";
import { actionProposal, createInstinctRegion } from "./instinct-region.js";

const signal = new AbortController().signal;
const questions: Question[] = [
  { kind: "choice", id: "next_action", prompt: "?", options: ["mine", "idle"] },
  { kind: "noul", id: "in_danger", statement: "danger" },
  { kind: "score", id: "spot", prompt: "?", min: 0, max: 10 },
];

describe("createInstinctRegion", () => {
  it("asks the engine and proposes its choice below full urgency", async () => {
    const region = createInstinctRegion({ engine: new EchoEngine(), questions: () => questions });
    expect(region).toMatchObject({ name: "instinct", layer: 1, everyMs: 0 });
    const out = await region.run(createWorkspace().viewFor("instinct"), signal);
    expect(out.proposals).toEqual([{ action: { skill: "idle" }, urgency: 0.8, reason: "chose idle (p=1.00, conf=1.00)" }]);
    expect(out.trace).toMatchObject({ engine: "echo", questions, answers: expect.any(Array) });
  });

  it("shares noul and score answers as signals", async () => {
    const answers: Answer[] = [
      { kind: "noul", id: "in_danger", value: 0.7 },
      { kind: "score", id: "spot", score: 2.5, confidence: 1 },
    ];
    const engine: DecisionEngine = { name: "fixed", decide: async () => answers };
    const store = createWorkspace();
    await createInstinctRegion({ engine, questions: () => questions }).run(store.viewFor("instinct"), signal);
    expect(store.signals()).toMatchObject({ in_danger: { value: 0.7, source: "instinct" }, spot: { value: 0.25 } });
  });

  it("builds questions from the workspace", async () => {
    const store = createWorkspace();
    store.viewFor("prefrontal").setGoal({ text: "build a shelter", steps: [], reason: "" });
    let prompt = "";
    const region = createInstinctRegion({
      engine: new EchoEngine(),
      questions: (ws) => {
        prompt = `Goal: ${ws.goal?.text}`;
        return [];
      },
    });
    await region.run(store.viewFor("instinct"), signal);
    expect(prompt).toBe("Goal: build a shelter");
  });
});

describe("actionProposal", () => {
  const choice: Answer = {
    kind: "choice",
    id: "next_action",
    choice: "attack",
    probabilities: { attack: 0.5, flee: 0.25, eat: 0.12, idle: 0.08, sleep: 0.05 },
    confidence: 0.5,
  };
  const target: Answer = { kind: "choice", id: "target", choice: "entity:1", probabilities: {}, confidence: 1 };

  it("proposes the likeliest options above 10%, urgency scaled by probability", () => {
    expect(actionProposal([choice, target], { acceptsTarget: (skill) => skill !== "eat", maxUrgency: 0.6 })).toEqual([
      { action: { skill: "attack", target: "entity:1" }, urgency: 0.3, reason: "chose attack (p=0.50, conf=0.50)" },
      { action: { skill: "flee", target: "entity:1" }, urgency: 0.15, reason: "option flee (p=0.25, conf=0.50)" },
      { action: { skill: "eat" }, urgency: expect.closeTo(0.072), reason: "option eat (p=0.12, conf=0.50)" },
    ]);
  });

  it("proposes at most maxOptions", () => {
    expect(actionProposal([choice], { maxOptions: 1 }).map((p) => p.action)).toEqual([{ skill: "attack" }]);
  });

  it("proposes nothing without a next_action answer", () => {
    expect(actionProposal([target])).toEqual([]);
  });
});
