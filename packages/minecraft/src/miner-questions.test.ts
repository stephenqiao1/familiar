import type { Choice } from "@familiar/contracts";
import { describe, expect, it } from "vitest";
import { minerQuestions } from "./miner-questions.js";

const nextAction: Choice = { kind: "choice", id: "next_action", prompt: "?", options: ["idle"] };
const target: Choice = { kind: "choice", id: "target", prompt: "?", options: ["none"] };

describe("minerQuestions", () => {
  it("asks all five questions in order with unique ids", () => {
    const questions = minerQuestions({ nextAction, target });
    expect(questions.map((q) => `${q.kind}:${q.id}`)).toEqual([
      "choice:next_action",
      "choice:target",
      "noul:in_danger",
      "noul:return_to_base",
      "score:mining_spot_quality",
    ]);
    expect(questions[4]).toMatchObject({ min: 0, max: 10 });
  });
});
