import type { SkillEvent } from "@familiar/contracts";
import { describe, expect, it } from "vitest";
import { createEpisodeTracker } from "./episodes.js";

const event = (skill: string, type: SkillEvent["type"]): SkillEvent => ({ skill, type, timestamp: 0 });

describe("createEpisodeTracker", () => {
  it("adds up the rewards from a skill's start to its end, in the situation it started in", () => {
    const tracker = createEpisodeTracker();
    expect(tracker.apply([event("eat", "started")], "day")).toEqual([]);
    tracker.credit(0.3);
    tracker.credit(-0.1);
    expect(tracker.apply([event("eat", "done")], "night")).toEqual([{ skill: "eat", situation: "day", outcome: expect.closeTo(0.2), ended: "done" }]);
  });

  it("ends the old episode before starting the next", () => {
    const tracker = createEpisodeTracker();
    tracker.apply([event("go_to", "started")], "day");
    tracker.credit(1);
    const ended = tracker.apply([event("go_to", "interrupted"), event("flee", "started")], "day");
    expect(ended).toEqual([{ skill: "go_to", situation: "day", outcome: 1, ended: "interrupted" }]);
    tracker.credit(0.5);
    expect(tracker.apply([event("flee", "failed")], "day")).toMatchObject([{ skill: "flee", outcome: 0.5 }]);
  });

  it("notes what kind of thing a skill was aimed at", () => {
    const tracker = createEpisodeTracker();
    const kinds: Record<string, string> = { "pos:1,2,3": "chest" };
    tracker.apply([{ ...event("go_to", "started"), target: "pos:1,2,3" }], "day", (t) => kinds[t]);
    expect(tracker.apply([event("go_to", "done")], "day")).toEqual([{ skill: "go_to", toward: "chest", situation: "day", outcome: 0, ended: "done" }]);
    tracker.apply([{ ...event("go_to", "started"), target: "pos:9,9,9" }], "day", (t) => kinds[t]);
    expect(tracker.apply([event("go_to", "done")], "day")).toEqual([{ skill: "go_to", situation: "day", outcome: 0, ended: "done" }]);
  });

  it("marks an episode fatal, and says whether a skill was running to credit", () => {
    const tracker = createEpisodeTracker();
    expect(tracker.credit(-1, true)).toBe(false);
    tracker.apply([event("go_to", "started")], "day");
    expect(tracker.credit(-1, true)).toBe(true);
    expect(tracker.apply([event("go_to", "interrupted")], "day")).toEqual([{ skill: "go_to", situation: "day", outcome: -1, fatal: true, ended: "interrupted" }]);
  });

  it("ignores rewards with no skill running, and ends for a skill it never saw start", () => {
    const tracker = createEpisodeTracker();
    tracker.credit(1);
    expect(tracker.apply([event("eat", "done")], "day")).toEqual([]);
  });
});
