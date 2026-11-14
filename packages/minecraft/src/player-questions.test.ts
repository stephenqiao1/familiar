import type { Choice } from "@familiar/contracts";
import { describe, expect, it } from "vitest";
import { playerQuestions } from "./player-questions.js";

const nextAction: Choice = { kind: "choice", id: "next_action", prompt: "?", options: ["idle"] };
const target: Choice = { kind: "choice", id: "target", prompt: "?", options: ["none"] };

describe("playerQuestions", () => {
  it("asks all four questions in order with unique ids", () => {
    const questions = playerQuestions({ nextAction, target });
    expect(questions.map((q) => `${q.kind}:${q.id}`)).toEqual([
      "choice:next_action",
      "choice:target",
      "noul:in_danger",
      "noul:return_to_base",
    ]);
  });
});
