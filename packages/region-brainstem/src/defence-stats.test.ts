import { describe, expect, it } from "vitest";
import { summariseDefence, type DefenceRow } from "./defence-stats.js";

const row = (at: number, mode: string, over: Partial<DefenceRow> = {}): DefenceRow => ({ at, mode, target: mode === "none" ? null : "z", kind: "zombie", present: mode === "none" ? [] : ["z"], ...over });

describe("summariseDefence", () => {
  it("adds up the time in each mode", () => {
    const s = summariseDefence([row(0, "none"), row(500, "freeze"), row(1500, "flee", { dist: 7, flightDistance: 8 }), row(2000, "none")]);
    expect(s.secondsIn).toEqual({ none: 0.5, freeze: 1, flee: 0.5 });
  });
  it("a freeze the threat never saw through worked; one it noticed failed", () => {
    expect(summariseDefence([row(0, "freeze"), row(500, "none")]).freezes).toEqual({ worked: 1, failed: 0 });
    expect(summariseDefence([row(0, "freeze"), row(500, "flee", { noticed: true })]).freezes).toEqual({ worked: 0, failed: 1 });
  });
  it("records each flight's starting distance", () => {
    const s = summariseDefence([row(0, "flee", { dist: 9, flightDistance: 10.4 }), row(500, "flee", { dist: 11 }), row(1000, "none")]);
    expect(s.flights).toEqual([{ kind: "zombie", startedAt: 9, flightDistance: 10.4 }]);
  });
  it("a fight is won when the threat is gone, lost when it ends in retreat or death", () => {
    expect(summariseDefence([row(0, "fight"), row(500, "none")]).fights).toEqual({ won: 1, lost: 0 });
    expect(summariseDefence([row(0, "fight"), row(500, "flee")]).fights).toEqual({ won: 0, lost: 1 });
    expect(summariseDefence([row(0, "fight"), row(500, "none", { died: true })]).fights).toEqual({ won: 0, lost: 1 });
  });
  it("counts cornered events, recoveries and what was learned, and lists a death's last 5 seconds", () => {
    const s = summariseDefence([
      row(0, "flee", { cornered: false }),
      row(1000, "fight", { cornered: true, dist: 2 }),
      row(2000, "fight", { cornered: true, dist: 1, learned: ["zombie became dangerous"] }),
      row(8000, "none", { died: true }),
      row(9000, "none", { recovering: true }),
    ]);
    expect(s.cornered).toBe(1);
    expect(s.recoveries).toBe(1);
    expect(s.learned).toEqual(["zombie became dangerous"]);
    expect(s.deaths).toEqual([{ at: 8000, before: [] }]);
    expect(summariseDefence([row(0, "fight", { dist: 2 }), row(3000, "none", { died: true })]).deaths[0]?.before).toEqual([{ msAgo: 3000, mode: "fight", kind: "zombie", dist: 2 }]);
  });
});
