import type { Candidate, Workspace } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { describe, expect, it } from "vitest";
import { contest } from "./choose.js";
import { score } from "./score.js";
import { desperateEasesRestraint, givenUp, holdForWant, learnedValue, restraint, standingChoice, stay, switching, urgeLoosensStay, type Term } from "./index.js";

// Each term on its own: what it adds or scales, and which layers it leaves alone.

const cand = (skill: string, urgency: number, layer = 1, region = layer === 0 ? "reflex" : "instinct"): Candidate => ({ region, layer, urgency, action: { skill }, reason: skill });
const keepGoing: Candidate = { region: "instinct", layer: 1, urgency: 0.5, action: { keepGoing: true }, reason: "carry on" };
function ws(current: string | null = null): Workspace {
  const store = createWorkspace();
  store.update({ schemaVersion: 1, timestamp: 0, game: "test", data: {} } as never, current ? { skill: current, target: undefined, startedAt: 0 } : null);
  return store.viewFor("arbiter");
}
const effects = (c: Candidate, terms: Term[]) => Object.fromEntries(score(c, terms, ws()).effects.map((e) => [e.term, e.effect]));

describe("the terms, one by one", () => {
  it("learned-value adds 0.2 × the value, on every layer, and nothing for an action that is not a skill", () => {
    const term = learnedValue({ valueOf: (skill) => (skill === "mine" ? 0.5 : -1) });
    expect(effects(cand("mine", 0.4), [term])).toEqual({ "learned-value": 0.1 });
    expect(effects(cand("flee", 0.4, 0), [term])).toEqual({ "learned-value": -0.2 });
    expect(score(keepGoing, [term], ws()).score).toBe(0.5);
  });

  it("stay adds the running skill's bonus; switching and the body's urge scale that bonus, not the score", () => {
    const base = stay({ bonusOf: (skill) => (skill === "mine" ? 0.15 : 0) });
    expect(effects(cand("mine", 0.4), [base])).toEqual({ stay: 0.15 });
    expect(effects(cand("idle", 0.4), [base])).toEqual({});
    const easier = [base, switching({ factorOf: () => 0.4 }), urgeLoosensStay({ urgeOf: () => 0.5 })];
    expect(effects(cand("mine", 0.4), easier).stay).toBeCloseTo(0.15 * 0.4 * 0.5);
    expect(score(cand("idle", 0.4), easier, ws()).score).toBe(0.4);
  });

  it("hold-for-want scales a decider's option down and leaves a reflex alone", () => {
    const term = holdForWant({ holdOf: () => 0.5 });
    expect(score(cand("mine", 0.8), [term], ws()).score).toBe(0.4);
    expect(score(cand("flee", 0.8, 0), [term], ws()).score).toBe(0.8);
    expect(score(keepGoing, [term], ws()).score).toBe(0.5);
  });

  it("restraint brakes by its strength; a desperate need eases the strength; a reflex is never braked", () => {
    const brake = restraint({ strengthOf: (skill) => (skill === "attack" ? 1 : 0), brake: (strength) => 1 - 0.4 * strength });
    expect(effects(cand("attack", 0.5), [brake])).toEqual({ restraint: 0.6 });
    expect(effects(cand("mine", 0.5), [brake])).toEqual({});
    expect(effects(cand("attack", 0.5, 0), [brake])).toEqual({});
    const eased = [brake, desperateEasesRestraint({ desperateOf: () => 1, most: 0.5 })];
    expect(effects(cand("attack", 0.5), eased).restraint).toBeCloseTo(0.8);
  });

  it("given-up removes a decider's candidate and lets a reflex start the same skill", () => {
    const term = givenUp({ heldBack: (skill) => skill === "mine" });
    const out = contest([cand("mine", 0.9), cand("idle", 0.2), cand("mine", 0.5, 0)], [term], ws());
    expect(out.removed.map((r) => [r.candidate.layer, r.by])).toEqual([[1, "given-up"]]);
    expect(out.winner).toMatchObject({ layer: 0, action: { skill: "mine" } });
  });

  it("standing-choice keeps the running skill's choice in the vote while its layer is silent", () => {
    const term = standingChoice();
    const chosen = cand("mine", 0.7);
    expect(contest([chosen], [term], ws()).recalled).toEqual([]);
    term.settled!(chosen, ws());
    // Its layer says nothing and the skill is running: the choice stands, against a weaker reflex.
    const silent = contest([cand("look", 0.3, 0)], [term], ws("mine"));
    expect(silent.recalled).toMatchObject([{ action: { skill: "mine" }, reason: "mine (still under way)" }]);
    expect(silent.winner).toBe(silent.recalled[0]);
    // The layer speaks again: what it says now counts. The skill no longer running: nothing stands.
    expect(contest([cand("idle", 0.2)], [term], ws("mine")).recalled).toEqual([]);
    expect(contest([cand("look", 0.3, 0)], [term], ws("idle")).recalled).toEqual([]);
    // A reflex's win is never remembered.
    const fresh = standingChoice();
    fresh.settled!(cand("flee", 0.9, 0), ws());
    expect(contest([], [fresh], ws("flee")).recalled).toEqual([]);
  });
});
