import { describe, expect, it } from "vitest";
import type { Question, State } from "@familiar/contracts";
import { EchoEngine } from "./echo-engine.js";

const state: State = { schemaVersion: 1, tick: 0, timestamp: 0, data: {} };

describe("EchoEngine", () => {
  const engine = new EchoEngine();

  it("picks 'idle' for a choice when present", async () => {
    const [answer] = await engine.decide(state, [
      { kind: "choice", id: "c", prompt: "?", options: ["mine", "idle", "flee"] },
    ]);
    expect(answer).toEqual({
      kind: "choice",
      id: "c",
      choice: "idle",
      probabilities: { idle: 1 },
      confidence: 1,
    });
  });

  it("falls back to the first option when 'idle' is absent", async () => {
    const [answer] = await engine.decide(state, [
      { kind: "choice", id: "c", prompt: "?", options: ["mine", "flee"] },
    ]);
    expect(answer).toMatchObject({ choice: "mine", probabilities: { mine: 1 } });
  });

  it("answers a score with the midpoint", async () => {
    const [answer] = await engine.decide(state, [
      { kind: "score", id: "s", prompt: "?", min: 2, max: 10 },
    ]);
    expect(answer).toEqual({ kind: "score", id: "s", score: 6, confidence: 1 });
  });

  it("answers a noul with 0", async () => {
    const [answer] = await engine.decide(state, [{ kind: "noul", id: "n", statement: "x" }]);
    expect(answer).toEqual({ kind: "noul", id: "n", value: 0 });
  });

  it("keeps ids and order", async () => {
    const questions: Question[] = [
      { kind: "noul", id: "a", statement: "x" },
      { kind: "choice", id: "b", prompt: "?", options: ["idle"] },
      { kind: "score", id: "c", prompt: "?", min: 0, max: 1 },
      { kind: "noul", id: "d", statement: "y" },
    ];
    const answers = await engine.decide(state, questions);
    expect(answers.map((a) => [a.kind, a.id])).toEqual(questions.map((q) => [q.kind, q.id]));
  });

  it("waits delayMs before answering", async () => {
    const start = performance.now();
    await new EchoEngine({ delayMs: 30 }).decide(state, []);
    expect(performance.now() - start).toBeGreaterThanOrEqual(25);
  });
});
