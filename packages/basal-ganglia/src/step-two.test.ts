import type { Action, Candidate, RunningSkill, State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { describe, expect, it } from "vitest";
import { bodyFirst, CONFLICT_SIGNAL, createBasalGanglia, share, stay, type BasalGangliaOptions, type Body, type Term } from "./index.js";

const PARTS: Record<string, string[] | undefined> = { flee: ["legs", "hands"], freeze: ["legs", "hands"], go_to: ["legs", "hands"], eat: ["hands"], look_at: ["head"], mine: ["hands", "head"], idle: [], flinch: [], whole: undefined };
const partsOf = (action: Action, running: RunningSkill | null) => ("skill" in action ? PARTS[action.skill] : running ? PARTS[running.skill] : []);
const BODY: Body = {
  channels: [{ name: "body", parts: ["legs", "hands"] }, { name: "head", parts: ["head"] }],
  partsOf: (action, ws) => partsOf(action, ws.current),
  free: (c) => "skill" in c.action && c.action.skill === "flinch",
};
const cand = (skill: string, urgency: number, layer = 1, region = layer === 0 ? "reflex" : "instinct"): Candidate => ({ region, layer, urgency, action: { skill }, reason: skill });
const skill = (c: Candidate | null | undefined) => (c && "skill" in c.action ? c.action.skill : null);

/** One basal ganglia on one workspace, a choice at a time. */
function brain(options: Partial<BasalGangliaOptions> & { terms?: Term[] }) {
  const store = createWorkspace();
  const arbiter = createBasalGanglia({ terms: [], ...options });
  let ms = 1000;
  return {
    arbiter,
    choose(candidates: Candidate[], running: string | null = null, afterMs = 100) {
      ms += afterMs;
      store.update({ schemaVersion: 0, tick: 0, timestamp: ms, data: {} } as State, running ? { skill: running, target: undefined, startedAt: 0 } : null);
      const chosen = arbiter.choose!(candidates, store.viewFor("arbiter"));
      return { ...chosen, won: skill(chosen.winner), beside: chosen.alongside.map(skill), conflict: store.signals()[CONFLICT_SIGNAL]?.value, trace: arbiter.trace!() as Record<string, any> };
    },
  };
}

describe("body first: the body's requests hold back the deciders' rivals", () => {
  const term = (strength = 1) => bodyFirst({ strength, clash: (a, b, ws) => share(partsOf(a.action, ws.current), partsOf(b.action, ws.current)) });

  it("a freeze at 0.78 beats a decider's flee at 0.79, which it would lose to without the term", () => {
    const vote = [cand("freeze", 0.78, 0), cand("flee", 0.79)];
    expect(brain({ terms: [] }).choose(vote).won).toBe("flee");
    const out = brain({ terms: [term()] }).choose(vote);
    expect(out.won).toBe("freeze");
    // 0.79 × (1 − 0.25 × 0.78)
    expect(out.trace.candidates.find((c: any) => c.skill === "flee")).toMatchObject({ terms: [{ term: "body-first", kind: "no-go", effect: 0.805 }], score: 0.636 });
    expect(out.trace.decidedBy).toEqual(["body-first"]);
  });

  it("a weak reflex can be overridden: at 0.3 it takes little off a decider's 0.5", () => {
    expect(brain({ terms: [term()] }).choose([cand("freeze", 0.3, 0), cand("go_to", 0.5)]).won).toBe("go_to");
  });

  it("a decider's option that uses other body parts, or is the same action, is not scaled", () => {
    const out = brain({ terms: [term()] }).choose([cand("freeze", 0.6, 0), cand("look_at", 0.5), cand("freeze", 0.4)]);
    expect(out.trace.candidates.filter((c: any) => c.layer === 1).map((c: any) => c.noGo)).toEqual([1, 1]);
  });

  it("is graded by its strength, and at 0 does nothing", () => {
    const vote = [cand("freeze", 0.78, 0), cand("flee", 0.79)];
    expect(brain({ terms: [term(0)] }).choose(vote).won).toBe("flee");
    expect(brain({ terms: [term(0)] }).choose(vote).trace.candidates[1].terms).toEqual([]);
    expect(brain({ terms: [term(0.5)] }).choose(vote).trace.candidates[1].noGo).toBeCloseTo(1 - 0.125 * 0.78, 2);
  });

  it("never touches a full-urgency candidate", () => {
    const out = brain({ terms: [term()] }).choose([cand("freeze", 0.9, 0), cand("flee", 1)]);
    expect(out).toMatchObject({ won: "flee", trace: { urgent: true } });
  });
});

describe("waiting on a near tie", () => {
  const wait = { strength: 1 };

  it("keeps whatever is running, shares how close it is, and settles after 300 ms: the faster layer wins", () => {
    const b = brain({ wait });
    const vote = [cand("go_to", 0.5), cand("eat", 0.52, 2, "prefrontal"), cand("idle", 0.3)];
    const first = b.choose(vote, "idle");
    expect(first).toMatchObject({ won: "idle", trace: { conflicts: [{ state: "waiting", closeness: 0.6, ms: 0 }] } });
    expect(first.conflict).toBeCloseTo(0.6);
    expect(b.arbiter.againInMs!()).toBe(300);
    expect(b.choose(vote, "idle", 200).won).toBe("idle");
    expect(b.arbiter.againInMs!()).toBe(100);
    const settled = b.choose(vote, "idle", 100);
    expect(settled).toMatchObject({ won: "go_to", conflict: 0, trace: { conflicts: [{ state: "settled", how: "faster layer", ms: 300 }] } });
    expect(settled.winner?.reason).toContain("near tie settled: faster layer");
    // The settlement stands while the same two stay that close: no new wait.
    expect(b.choose(vote, "idle", 100).won).toBe("go_to");
    expect(b.arbiter.againInMs!()).toBeNull();
  });

  it("with nothing running in the vote, nobody goes ahead while it waits", () => {
    const b = brain({ wait });
    expect(b.choose([cand("go_to", 0.5), cand("eat", 0.52)], null)).toMatchObject({ winner: null, trace: { conflicts: [{ state: "waiting" }] } });
  });

  it("on the same layer the one already running wins; with neither running, the higher go total", () => {
    const a = brain({ wait });
    const vote = [cand("go_to", 0.5), cand("eat", 0.52)];
    a.choose(vote, "go_to");
    expect(a.choose(vote, "go_to", 300)).toMatchObject({ won: "go_to", trace: { conflicts: [{ how: "already running" }] } });
    const go: Term = { name: "liked", kind: "go", amount: (c) => (skill(c) === "go_to" ? 0.1 : 0) };
    const b = brain({ wait, terms: [go] });
    const other = [cand("go_to", 0.4), cand("eat", 0.52)];
    b.choose(other, null);
    expect(b.choose(other, null, 300)).toMatchObject({ won: "go_to", trace: { conflicts: [{ how: "higher go total" }] } });
  });

  it("does not wait when the scores are apart, the two are the same action, or one is at full urgency", () => {
    expect(brain({ wait }).choose([cand("go_to", 0.5), cand("eat", 0.56)]).trace.conflicts).toBeUndefined();
    expect(brain({ wait }).choose([cand("go_to", 0.5), cand("go_to", 0.52, 2, "prefrontal")]).won).toBe("go_to");
    expect(brain({ wait }).choose([cand("go_to", 0.99), cand("eat", 1)])).toMatchObject({ won: "eat", conflict: 0 });
  });

  it("never holds back a request of the body above 0.8, and never waits while something is on the bot", () => {
    expect(brain({ wait }).choose([cand("flee", 0.85, 0), cand("go_to", 0.86)]).won).toBe("go_to");
    expect(brain({ wait }).choose([cand("flee", 0.85, 0), cand("go_to", 0.84)]).won).toBe("flee");
    expect(brain({ wait: { strength: 1, pressing: () => true } }).choose([cand("go_to", 0.5), cand("eat", 0.52)]).won).toBe("eat");
  });

  it("a wait ends when the tie does, and a new pair starts a new one", () => {
    const b = brain({ wait });
    b.choose([cand("go_to", 0.5), cand("eat", 0.52)], null);
    expect(b.choose([cand("go_to", 0.5), cand("eat", 0.7)], null, 200).won).toBe("eat");
    expect(b.choose([cand("go_to", 0.5), cand("flee", 0.52)], null, 200).trace.conflicts[0]).toMatchObject({ state: "waiting", ms: 0 });
  });

  it("at strength 0 never waits and writes no signal", () => {
    const out = brain({ wait: { strength: 0 } }).choose([cand("go_to", 0.5), cand("eat", 0.52)]);
    expect(out).toMatchObject({ won: "eat" });
    expect(out.conflict).toBeUndefined();
  });
});

describe("channels: a contest for each part of the body", () => {
  it("a look and a walk both go ahead: the walk is the action, the look runs alongside", () => {
    const out = brain({ body: BODY }).choose([cand("go_to", 0.6), cand("look_at", 0.4, 0, "colliculus")], "go_to");
    expect(out).toMatchObject({ won: "go_to", beside: ["look_at"] });
    expect(out.trace.channels.head).toMatchObject({ winner: { skill: "look_at" } });
  });

  it("a look no longer has to beat idling: they are in different contests", () => {
    expect(brain({ body: BODY }).choose([cand("idle", 0.9), cand("look_at", 0.35, 0, "colliculus")], "idle")).toMatchObject({ won: "idle", beside: ["look_at"] });
    // With one contest the same look loses outright.
    expect(brain({}).choose([cand("idle", 0.9), cand("look_at", 0.35, 0, "colliculus")], "idle")).toMatchObject({ won: "idle", beside: [] });
  });

  it("a whole-body skill wins both channels or neither", () => {
    // Mining (hands and head) beats the look for the head and the walk for the hands: it has both.
    expect(brain({ body: BODY }).choose([cand("mine", 0.7), cand("look_at", 0.4, 0, "colliculus"), cand("go_to", 0.5)])).toMatchObject({ won: "mine", beside: [] });
    // It loses the head to a stronger look: it gets neither, and the walk has the body.
    const out = brain({ body: BODY }).choose([cand("mine", 0.7), cand("look_at", 0.8, 0, "colliculus"), cand("go_to", 0.5)]);
    expect(out).toMatchObject({ won: "go_to", beside: ["look_at"], trace: { dropped: [{ skill: "mine", lost: "head", to: { skill: "look_at" } }] } });
  });

  it("a look that beats the running whole-body skill takes over, as with one contest", () => {
    const out = brain({ body: BODY }).choose([cand("look_at", 0.8, 0, "colliculus")], "mine");
    expect(out).toMatchObject({ won: "look_at", beside: [], trace: { promoted: { skill: "look_at" } } });
  });

  it("a look beside a running skill that leaves the head free does not disturb it", () => {
    expect(brain({ body: BODY }).choose([cand("look_at", 0.4, 0, "colliculus")], "go_to")).toMatchObject({ winner: null, beside: ["look_at"] });
  });

  it("full urgency wins its own channel at once and leaves the other alone", () => {
    const out = brain({ body: BODY }).choose([cand("flee", 1, 0), cand("go_to", 0.9), cand("look_at", 0.4, 0, "colliculus")]);
    expect(out).toMatchObject({ won: "flee", beside: ["look_at"], trace: { urgent: true } });
    // A full-urgency whole-body reflex takes both.
    expect(brain({ body: BODY }).choose([cand("whole", 1, 0), cand("look_at", 0.9, 0, "colliculus")])).toMatchObject({ won: "whole", beside: [] });
  });

  it("a flinch needs no contest: it runs beside whatever wins", () => {
    expect(brain({ body: BODY }).choose([cand("go_to", 0.6), cand("flinch", 0.5, 0)])).toMatchObject({ won: "go_to", beside: ["flinch"] });
  });

  it("the stay bonus of a running skill counts in every channel it uses", () => {
    const out = brain({ body: BODY, terms: [stay({ bonusOf: (name) => (name === "mine" ? 0.15 : 0) })] }).choose([cand("mine", 0.7), cand("look_at", 0.8, 0, "colliculus")], "mine");
    expect(out).toMatchObject({ won: "mine", beside: [], trace: { decidedBy: ["stay"] } });
  });

  it("settles early only on a full-urgency candidate for the main channel", () => {
    const { arbiter } = brain({ body: BODY });
    const ws = createWorkspace().viewFor("arbiter");
    expect(arbiter.settledEarly!([cand("look_at", 1, 0, "colliculus")], [1], ws)).toBeNull();
    expect(skill(arbiter.settledEarly!([cand("look_at", 1, 0, "colliculus"), cand("flee", 1, 0)], [1], ws))).toBe("flee");
  });

  it("the same inputs give the same winners", () => {
    const vote = () => [cand("mine", 0.7), cand("look_at", 0.72, 0, "colliculus"), cand("go_to", 0.5), cand("eat", 0.51)];
    const run = () => {
      const b = brain({ body: BODY, wait: { strength: 1 } });
      return [b.choose(vote(), "go_to"), b.choose(vote(), "go_to", 150), b.choose(vote(), "go_to", 150)].map((o) => [o.won, o.beside]);
    };
    expect(run()).toEqual(run());
  });
});
