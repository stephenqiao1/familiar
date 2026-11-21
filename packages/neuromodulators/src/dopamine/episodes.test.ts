import type { SkillEvent } from "@familiar/contracts";
import { describe, expect, it } from "vitest";
import { aimOf, createEpisodeTracker } from "./episodes.js";

const event = (skill: string, type: SkillEvent["type"]): SkillEvent => ({ skill, type, timestamp: 0 });

describe("createEpisodeTracker", () => {
  it("adds up the rewards from a skill's start to its end, in the situation it started in", () => {
    const tracker = createEpisodeTracker();
    expect(tracker.apply([event("eat", "started")], "day")).toEqual([]);
    tracker.credit(0.3);
    tracker.credit(-0.1);
    expect(tracker.apply([event("eat", "done")], "night")).toEqual([{ skill: "eat", situation: "day", outcome: expect.closeTo(0.2), gained: 0.3, effort: 0, ended: "done" }]);
  });

  it("ends the old episode before starting the next", () => {
    const tracker = createEpisodeTracker();
    tracker.apply([event("go_to", "started")], "day");
    tracker.credit(1);
    const ended = tracker.apply([event("go_to", "interrupted"), event("flee", "started")], "day");
    expect(ended).toEqual([{ skill: "go_to", situation: "day", outcome: 1, gained: 1, effort: 0, ended: "interrupted" }]);
    tracker.credit(0.5);
    expect(tracker.apply([event("flee", "failed")], "day")).toMatchObject([{ skill: "flee", outcome: 0.5 }]);
  });

  it("settles the aim when the run ends, if it was not known at the start", () => {
    const aims: Record<string, { kind: string; id?: string }> = { "pos:1,2,3": { kind: "chest", id: "pos:1,2,3" } };
    // The skill chose the chest itself and says so at the end.
    const tracker = createEpisodeTracker();
    tracker.advance({ events: [event("take_items", "started")], from: 0, to: 1, situation: "day", aimOf: (t) => aims[t] });
    const picked = tracker.advance({ events: [{ ...event("take_items", "done"), aimedAt: "pos:1,2,3" }], from: 1, to: 2, situation: "day", aimOf: (t) => aims[t] });
    expect(picked.ended).toMatchObject([{ skill: "take_items", toward: "chest", towardId: "pos:1,2,3" }]);
    // The target was out of sight at the start and known by the end.
    tracker.advance({ events: [{ ...event("go_to", "started"), target: "pos:1,2,3" }], from: 2, to: 3, situation: "day", aimOf: () => undefined });
    const reached = tracker.advance({ events: [{ ...event("go_to", "done"), target: "pos:1,2,3" }], from: 3, to: 4, situation: "day", aimOf: (t) => aims[t] });
    expect(reached.ended).toMatchObject([{ skill: "go_to", toward: "chest", towardId: "pos:1,2,3" }]);
  });

  it("notes what kind of thing a skill was aimed at", () => {
    const tracker = createEpisodeTracker();
    const aims: Record<string, { kind: string; id?: string }> = { "pos:1,2,3": { kind: "chest", id: "pos:1,2,3" }, "entity:4": { kind: "cow" } };
    tracker.apply([{ ...event("go_to", "started"), target: "pos:1,2,3" }], "day", (t) => aims[t]);
    const [toChest] = tracker.apply([event("go_to", "done")], "day");
    expect(toChest).toEqual({ skill: "go_to", toward: "chest", towardId: "pos:1,2,3", situation: "day", outcome: 0, gained: 0, effort: 0, ended: "done" });
    expect(aimOf(toChest!)).toEqual({ kind: "chest", id: "pos:1,2,3" });
    tracker.apply([{ ...event("go_to", "started"), target: "entity:4" }], "day", (t) => aims[t]);
    const [toCow] = tracker.apply([event("go_to", "done")], "day");
    expect(toCow).toMatchObject({ toward: "cow" });
    expect(aimOf(toCow!)).toEqual({ kind: "cow" });
    tracker.apply([{ ...event("go_to", "started"), target: "pos:9,9,9" }], "day", (t) => aims[t]);
    expect(tracker.apply([event("go_to", "done")], "day")).toEqual([{ skill: "go_to", situation: "day", outcome: 0, gained: 0, effort: 0, ended: "done" }]);
  });

  it("marks an episode fatal, and says whether a skill was running to credit", () => {
    const tracker = createEpisodeTracker();
    expect(tracker.credit(-1, true)).toBe(false);
    tracker.apply([event("go_to", "started")], "day");
    expect(tracker.credit(-1, true)).toBe(true);
    expect(tracker.apply([event("go_to", "interrupted")], "day")).toEqual([{ skill: "go_to", situation: "day", outcome: -1, gained: 0, effort: 0, fatal: true, ended: "interrupted" }]);
  });

  it("adds up the work put in, and keeps what was earned apart from what went wrong", () => {
    const tracker = createEpisodeTracker();
    tracker.spend(0.2); // no skill running: nobody's work
    tracker.apply([event("go_to", "started")], "day");
    tracker.spend(0.05);
    tracker.spend(0.1);
    tracker.spend(-1); // never negative
    tracker.credit(0.1, false, 0.4); // +0.4 earned, -0.3 lost, on the same tick
    expect(tracker.apply([event("go_to", "done")], "day")).toMatchObject([{ outcome: 0.1, gained: 0.4, effort: expect.closeTo(0.15) }]);
  });

  it("ignores rewards with no skill running, and ends for a skill it never saw start", () => {
    const tracker = createEpisodeTracker();
    tracker.credit(1);
    expect(tracker.apply([event("eat", "done")], "day")).toEqual([]);
  });
});

describe("advance: who gets a tick's rewards", () => {
  const at = (skill: string, type: SkillEvent["type"], timestamp: number): SkillEvent => ({ skill, type, timestamp });
  /** A tick from 1000 to 1500 ms worth +1, with these events; returns the tracker and what ended. */
  function tick(tracker: ReturnType<typeof createEpisodeTracker>, events: SkillEvent[], amount = 1) {
    return tracker.advance({ events, from: 1000, to: 1500, situation: "day", amount, effort: 0.1 });
  }

  it("gives it to the skill that was running", () => {
    const tracker = createEpisodeTracker();
    tracker.apply([event("eat", "started")], "day");
    expect(tick(tracker, [])).toEqual({ ended: [], credited: true });
    expect(tick(tracker, [at("eat", "done", 1400)]).ended).toMatchObject([{ skill: "eat", outcome: 2, gained: 2, effort: 0.2 }]);
  });

  it("gives nothing to a skill that only just started, with no time on its events", () => {
    const tracker = createEpisodeTracker();
    expect(tick(tracker, [event("eat", "started")])).toEqual({ ended: [], credited: false });
    expect(tick(tracker, [event("eat", "done")]).ended).toMatchObject([{ outcome: 1 }]);
  });

  it("gives it to the one that ran for most of the tick, when one skill ends and another starts", () => {
    const early = createEpisodeTracker();
    early.apply([event("idle", "started")], "day");
    // idle stops 50 ms in; take_items runs the other 450 ms.
    tick(early, [at("idle", "interrupted", 1050), at("take_items", "started", 1050)]);
    expect(early.apply([event("take_items", "done")], "day")).toMatchObject([{ skill: "take_items", outcome: 1 }]);

    const late = createEpisodeTracker();
    late.apply([event("idle", "started")], "day");
    const { ended } = tick(late, [at("idle", "interrupted", 1450), at("take_items", "started", 1450)]);
    expect(ended).toMatchObject([{ skill: "idle", outcome: 1 }]);
    expect(late.apply([event("take_items", "done")], "day")).toMatchObject([{ skill: "take_items", outcome: 0 }]);
  });

  it("gives it to a whole run that started and ended inside the tick", () => {
    const timed = createEpisodeTracker();
    expect(tick(timed, [at("take_items", "started", 1100), at("take_items", "done", 1300)])).toMatchObject({ ended: [{ skill: "take_items", outcome: 1, effort: 0.1 }], credited: true });
    // Even with no times on its events, if nothing else was running.
    const untimed = createEpisodeTracker();
    expect(tick(untimed, [event("take_items", "started"), event("take_items", "done")]).ended).toMatchObject([{ skill: "take_items", outcome: 1 }]);
  });

  it("marks the one credited as fatal, and says when nobody was there", () => {
    const tracker = createEpisodeTracker();
    expect(tracker.advance({ events: [], from: 0, to: 500, situation: "day", amount: -1, fatal: true }).credited).toBe(false);
    tracker.apply([event("go_to", "started")], "day");
    tracker.advance({ events: [], from: 500, to: 1000, situation: "day", amount: -1, fatal: true });
    expect(tracker.apply([event("go_to", "interrupted")], "day")).toMatchObject([{ fatal: true, outcome: -1, gained: 0 }]);
  });

  it("gives a reward that is about one skill to that skill's run, however briefly it ran", () => {
    const tracker = createEpisodeTracker();
    tracker.apply([event("idle", "started")], "day");
    // idle is cut short at once; the reflex runs the rest of the tick and the hurt lands in it.
    const { ended } = tracker.advance({ events: [at("idle", "failed", 1010), at("air_steer", "started", 1010)], from: 1000, to: 1500, situation: "day", amount: -0.3, about: [{ skill: "idle", amount: -0.1 }] });
    expect(ended).toMatchObject([{ skill: "idle", outcome: -0.1 }]);
    expect(tracker.apply([event("air_steer", "done")], "day")).toMatchObject([{ skill: "air_steer", outcome: -0.3 }]);
    // A reward about a skill that is not running goes to nobody.
    expect(tracker.advance({ events: [], from: 1500, to: 2000, situation: "day", about: [{ skill: "sleep", amount: 1 }] })).toEqual({ ended: [], credited: false });
  });

  it("still credits the running skill on a tick of no length", () => {
    const tracker = createEpisodeTracker();
    tracker.apply([event("eat", "started")], "day");
    tracker.advance({ events: [], from: 5, to: 5, situation: "day", amount: 1 });
    expect(tracker.apply([event("eat", "done")], "day")).toMatchObject([{ outcome: 1 }]);
  });
});
