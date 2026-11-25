import type { Candidate } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { describe, expect, it } from "vitest";
import { createBasalGanglia, givenUp, holdForWant, learnedValue, stay, type Term } from "./index.js";

const cand = (skill: string, urgency: number, layer = 1): Candidate => ({ region: layer === 0 ? "reflex" : "instinct", layer, urgency, action: { skill }, reason: skill });
const view = () => createWorkspace().viewFor("arbiter");
const pick = (terms: Term[], candidates: Candidate[]) => {
  const arbiter = createBasalGanglia({ terms });
  return { winner: arbiter.pick(candidates, view()), trace: arbiter.trace!() as { candidates: { skill: string; terms: unknown[]; go: number; noGo: number; score: number; won?: boolean }[]; decidedBy?: string[]; removed?: unknown[]; urgent?: boolean; ms: number } };
};

describe("the basal ganglia", () => {
  it("with no terms, the most urgent wins; a tie goes to the faster layer, then the first listed", () => {
    expect(pick([], [cand("a", 0.5), cand("b", 0.6)]).winner?.action).toEqual({ skill: "b" });
    expect(pick([], [cand("a", 0.6), cand("b", 0.6, 0)]).winner?.action).toEqual({ skill: "b" });
    expect(pick([], [cand("a", 0.6), cand("b", 0.6)]).winner?.action).toEqual({ skill: "a" });
    expect(pick([], []).winner).toBeNull();
  });

  it("score = (urgency + go) × no-go, and the trace says what each term did to each candidate", () => {
    const terms = [learnedValue({ valueOf: (skill) => (skill === "mine" ? 1 : 0) }), holdForWant({ holdOf: (skill) => (skill === "mine" ? 0.5 : 1) })];
    const { winner, trace } = pick(terms, [cand("mine", 0.9), cand("idle", 0.6)]);
    expect(trace.candidates).toMatchObject([
      { skill: "mine", terms: [{ term: "learned-value", kind: "go", effect: 0.2 }, { term: "hold-for-want", kind: "no-go", effect: 0.5 }], go: 0.2, noGo: 0.5, score: 0.55 },
      { skill: "idle", terms: [], go: 0, noGo: 1, score: 0.6, won: true },
    ]);
    // Without the hold, mining would have won: the hold decided it.
    expect(trace.decidedBy).toEqual(["hold-for-want"]);
    expect(winner?.reason).toBe("idle; decided by hold-for-want");
    expect(trace.ms).toBeLessThan(1);
  });

  it("the winner's reason names what moved its score and which terms decided", () => {
    const { winner, trace } = pick([stay({ bonusOf: (skill) => (skill === "mine" ? 0.15 : 0) })], [cand("mine", 0.5), cand("idle", 0.6)]);
    expect(winner?.reason).toBe("mine; stay +0.15; decided by stay");
    expect(trace.decidedBy).toEqual(["stay"]);
    // A term that moved a score without changing who won decided nothing.
    expect(pick([stay({ bonusOf: (skill) => (skill === "mine" ? 0.15 : 0) })], [cand("mine", 0.7), cand("idle", 0.6)]).winner?.reason).toBe("mine; stay +0.15");
  });

  it("a full-urgency candidate wins at once: no term is asked, nothing can remove it", () => {
    const never: Term = { name: "never", kind: "no-go", amount: () => 0 };
    const { winner, trace } = pick([never, givenUp({ heldBack: () => true })], [cand("flee", 1, 0), cand("mine", 0.9)]);
    expect(winner).toMatchObject({ action: { skill: "flee" }, reason: "flee" });
    expect(trace).toMatchObject({ urgent: true, removed: [{ skill: "mine", by: "given-up" }] });
  });

  it("settles early only when nothing still running could beat a full-urgency candidate", () => {
    const arbiter = createBasalGanglia({ terms: [] });
    const flee = cand("flee", 1, 0);
    expect(arbiter.settledEarly!([flee], [1, 2], view())).toBe(flee);
    expect(arbiter.settledEarly!([cand("flee", 0.99, 0)], [1], view())).toBeNull();
    expect(arbiter.settledEarly!([cand("run", 1, 1)], [0], view())).toBeNull();
  });

  it("the same inputs give the same winner and the same trace", () => {
    const terms = () => [learnedValue({ valueOf: (skill) => skill.length / 10 })];
    const candidates = [cand("mine", 0.5), cand("explore", 0.45), cand("look", 0.5, 0)];
    const [a, b] = [pick(terms(), candidates), pick(terms(), candidates)];
    expect(a.winner).toEqual(b.winner);
    expect({ ...a.trace, ms: 0, worstMs: 0 }).toEqual({ ...b.trace, ms: 0, worstMs: 0 });
  });
});
