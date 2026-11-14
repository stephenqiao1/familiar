import type { Answer } from "@familiar/contracts";
import { describe, expect, it } from "vitest";
import { actionFor } from "./answers-to-action.js";

const target = (picked: string): Answer => ({ kind: "choice", id: "target", choice: picked, probabilities: { [picked]: 1 }, confidence: 1 });

describe("actionFor", () => {
  it("attaches the target when the skill accepts it", () => {
    expect(actionFor("attack", [target("entity:42")], () => true)).toEqual({ skill: "attack", target: "entity:42" });
  });

  it("leaves the target off when it is missing, none, rejected, or no check is given", () => {
    expect(actionFor("idle", [{ kind: "noul", id: "target", value: 1 }], () => true)).toEqual({ skill: "idle" });
    expect(actionFor("idle", [target("none")], () => true)).toEqual({ skill: "idle" });
    expect(actionFor("eat", [target("pos:1,2,3")], () => false)).toEqual({ skill: "eat" });
    expect(actionFor("eat", [target("pos:1,2,3")])).toEqual({ skill: "eat" });
  });

  it("asks the check about the skill and target", () => {
    const seen: string[] = [];
    actionFor("go_to", [target("pos:1,2,3")], (s, t) => (seen.push(`${s} ${t}`), true));
    expect(seen).toEqual(["go_to pos:1,2,3"]);
  });
});
