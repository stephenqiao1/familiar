import type { Answer } from "@familiar/contracts";
import { describe, expect, it } from "vitest";
import { answersToAction } from "./answers-to-action.js";

const choice = (id: string, picked: string): Answer => ({ kind: "choice", id, choice: picked, probabilities: { [picked]: 1 }, confidence: 1 });

describe("answersToAction", () => {
  it("uses the next_action choice as the skill", () => {
    expect(answersToAction([{ kind: "noul", id: "x", value: 0 }, choice("next_action", "mine")])).toEqual({ skill: "mine" });
  });

  it("keeps going without a next_action choice", () => {
    expect(answersToAction([{ kind: "noul", id: "next_action", value: 1 }])).toEqual({ keepGoing: true });
  });

  it("attaches the target when the skill accepts it", () => {
    const answers = [choice("next_action", "attack"), choice("target", "entity:42")];
    expect(answersToAction(answers, () => true)).toEqual({ skill: "attack", target: "entity:42" });
  });

  it("leaves the target off when it is none, rejected, or no check is given", () => {
    expect(answersToAction([choice("next_action", "idle"), choice("target", "none")], () => true)).toEqual({ skill: "idle" });
    expect(answersToAction([choice("next_action", "eat"), choice("target", "pos:1,2,3")], () => false)).toEqual({ skill: "eat" });
    expect(answersToAction([choice("next_action", "eat"), choice("target", "pos:1,2,3")])).toEqual({ skill: "eat" });
  });

  it("asks the check about the chosen skill and target", () => {
    const seen: string[] = [];
    answersToAction([choice("next_action", "go_to"), choice("target", "pos:1,2,3")], (s, t) => (seen.push(`${s} ${t}`), true));
    expect(seen).toEqual(["go_to pos:1,2,3"]);
  });
});
