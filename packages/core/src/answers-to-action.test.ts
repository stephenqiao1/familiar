import { describe, expect, it } from "vitest";
import { answersToAction } from "./answers-to-action.js";

describe("answersToAction", () => {
  it("uses the next_action choice as the skill", () => {
    expect(
      answersToAction([
        { kind: "noul", id: "x", value: 0 },
        { kind: "choice", id: "next_action", choice: "mine", probabilities: { mine: 1 }, confidence: 1 },
      ]),
    ).toEqual({ skill: "mine" });
  });

  it("keeps going without a next_action choice", () => {
    expect(answersToAction([{ kind: "noul", id: "next_action", value: 1 }])).toEqual({ keepGoing: true });
  });
});
