import { describe, expect, it } from "vitest";
import { ASKS, createAsks } from "./asks.js";
import { AROUSAL, fullShare, limitFor, mostItems } from "./budget.js";
import { createBursts, QUIET_MS } from "./burst.js";
import { fill, makeRoom, type Candidate } from "./fill.js";
import { openedBy } from "./gate.js";
import { priorityOf, WEIGHTS, type Facts } from "./priority.js";

// The thalamus's small rules, each with plain numbers.

const ON = { spotlight: 1, threats: 1, wants: 1, detail: 1 };
const OFF = { spotlight: 0, threats: 0, wants: 0, detail: 0 };

describe("priority", () => {
  const base = { base: 0.3 };
  it("starts from the channel's base, and each modulator raises it by its weight", () => {
    expect(priorityOf(base, ON)).toEqual({ priority: 0.3, by: [] });
    const raised: [Facts, string][] = [
      [{ ...base, attended: true }, "attended"],
      [{ ...base, target: true }, "target"],
      [{ ...base, threat: 1 }, "threat"],
      [{ ...base, threat: 2 }, "threat"],
      [{ ...base, asked: true }, "asked"],
      [{ ...base, wanted: 0.8 }, "wanted"],
      [{ ...base, watched: true }, "watched"],
      [{ ...base, fresh: true }, "fresh"],
      [{ ...base, dist: 2 }, "near"],
    ];
    for (const [facts, name] of raised) {
      const { priority, by } = priorityOf(facts, ON);
      expect(priority, name).toBeGreaterThan(0.3);
      expect(by, name).toEqual([name]);
    }
    expect(priorityOf({ ...base, attended: true }, ON).priority).toBeCloseTo(0.3 + WEIGHTS.attended);
    expect(priorityOf({ ...base, wanted: 0.5 }, ON).priority).toBeCloseTo(0.3 + 0.5 * WEIGHTS.wanted);
  });

  it("a thing that has been got used to drops", () => {
    const { priority, by } = priorityOf({ ...base, usedTo: 0.8 }, ON);
    expect(priority).toBeCloseTo(0.3 + 0.8 * WEIGHTS.usedTo);
    expect(by).toEqual(["used to"]);
  });

  it("the trace names every modulator that moved it; a pressing threat counts for more than a seen one, and an ask comes after threats", () => {
    expect(priorityOf({ ...base, attended: true, fresh: true, dist: 1, usedTo: 0.5 }, ON).by).toEqual(["attended", "fresh", "near", "used to"]);
    expect(priorityOf({ ...base, threat: 2 }, ON).priority).toBeGreaterThan(priorityOf({ ...base, threat: 1 }, ON).priority);
    expect(priorityOf({ ...base, threat: 1 }, ON).priority).toBeGreaterThan(priorityOf({ ...base, asked: true }, ON).priority);
  });

  it("each steerable modulator has its own strength; it stays between 0 and 1", () => {
    expect(priorityOf({ ...base, attended: true, target: true, threat: 2, asked: true, wanted: 1 }, OFF)).toEqual({ priority: 0.3, by: [] });
    expect(priorityOf({ base: 0.9, attended: true, target: true, threat: 2 }, ON).priority).toBe(1);
    expect(priorityOf({ base: 0.1, usedTo: 1 }, ON).priority).toBe(0);
  });
});

describe("the gate", () => {
  it("a channel is turned down unless something in it opens it; each opener opens it", () => {
    expect(openedBy([{ base: 0.3 }, { base: 0.3, fresh: true, dist: 1, usedTo: 0.5 }], ON)).toBeNull();
    expect(openedBy([{ base: 0.3 }, { base: 0.3, attended: true }], ON)).toBe("the attended thing");
    expect(openedBy([{ base: 0.3, target: true }], ON)).toBe("the running skill's target");
    expect(openedBy([{ base: 0.3, threat: 2 }], ON)).toBe("a threat in view");
    expect(openedBy([{ base: 0.3, threat: 1 }], ON)).toBe("a threat in view");
    expect(openedBy([{ base: 0.3, wanted: 0.4 }], ON)).toBe("a wanted thing");
    expect(openedBy([{ base: 0.3, watched: true }], ON)).toBe("the goal asks for it");
    expect(openedBy([{ base: 0.3, asked: true }], ON)).toBe("the goal asks for it");
  });

  it("an opener whose strength is 0 opens nothing", () => {
    expect(openedBy([{ base: 0.3, attended: true, target: true, threat: 2, wanted: 1, asked: true }], OFF)).toBeNull();
  });
});

describe("the budget", () => {
  it("arousal sets the size: about a third when drowsy, whole when awake", () => {
    expect(limitFor(1500, 0.5, 1)).toBe(1500);
    expect(limitFor(1500, 0.9, 1)).toBe(1500);
    expect(limitFor(1500, 0.2, 1)).toBe(500);
    expect(limitFor(1500, 0.4, 1)).toBe(1000);
    expect(limitFor(1500, 0.2, 0)).toBe(1500);
  });

  it("over-aroused, the limit stays but only the top few items get any form", () => {
    expect(mostItems(0.95, 1)).toBe(AROUSAL.frazzledTop);
    expect(mostItems(0.8, 1)).toBe(Infinity);
    expect(mostItems(0.95, 0)).toBe(Infinity);
  });

  it("focus sets the shape: high, the room goes to full forms; low, to brief ones", () => {
    expect(fullShare(1, 1)).toBe(1);
    expect(fullShare(0.5, 1)).toBe(0.5);
    expect(fullShare(0, 1)).toBe(0);
    expect(fullShare(0.2, 0)).toBe(1);
  });
});

describe("the fill", () => {
  const item = (id: string, priority: number, over: Partial<Candidate> = {}): Candidate => ({ id, channel: "things", priority, cost: { full: 100, brief: 20 }, open: true, must: false, ...over });
  const forms = (items: Candidate[], limit: number, over: object = {}) => {
    const filled = fill({ items, limit, fixed: 0, ...over });
    return { ...filled, forms: Object.fromEntries(filled.forms) };
  };

  it("full while there is room, then brief, then counted, in order of priority", () => {
    const items = [item("d", 0.1), item("a", 0.9), item("c", 0.5), item("b", 0.7), item("e", 0.05)];
    const out = forms(items, 250);
    // 100 + 100 for the two that matter most, then 20 + 20, then nothing fits.
    expect(out.forms).toEqual({ a: "full", b: "full", c: "brief", d: "brief", e: "counted" });
    expect(out.spent).toBe(240);
    expect(out.heldBack).toEqual({ things: 1 });
  });

  it("the limit is respected, the fixed part counts, and the held-back counts add up", () => {
    const items = Array.from({ length: 30 }, (_, i) => item(`i${i}`, 1 - i / 30, { channel: i % 2 ? "creatures" : "things" }));
    for (const limit of [0, 150, 700, 2000, 10_000]) {
      const out = fill({ items, limit, fixed: 100 });
      expect(out.spent).toBeLessThanOrEqual(Math.max(limit, 100));
      const counted = [...out.forms.values()].filter((f) => f === "counted").length;
      expect(Object.values(out.heldBack).reduce((a, b) => a + b, 0)).toBe(counted);
      expect(out.forms.size).toBe(30);
    }
  });

  it("an item in a turned-down channel is never given in full", () => {
    const out = forms([item("a", 0.9, { open: false }), item("b", 0.5)], 1000);
    expect(out.forms).toEqual({ a: "brief", b: "full" });
  });

  it("what may never be held back gets its form whatever the limit, and the overrun is reported", () => {
    const out = forms([item("vital", 0.2, { must: true }), item("other", 0.9), item("closed", 0.1, { must: true, open: false })], 50);
    expect(out.forms).toEqual({ vital: "full", closed: "brief", other: "counted" });
    expect(out.over).toBe(70);
    expect(forms([item("vital", 0.2, { must: true })], 500).over).toBe(0);
  });

  it("a shape splits the room between full and brief forms", () => {
    const items = Array.from({ length: 8 }, (_, i) => item(`i${i}`, 1 - i / 10));
    const count = (out: ReturnType<typeof forms>, form: string) => Object.values(out.forms).filter((f) => f === form).length;
    const high = forms(items, 400, { fullShare: 1, shaped: true });
    const low = forms(items, 400, { fullShare: 0, shaped: true });
    // High focus: four in full, the rest counted. Low focus: all eight, in brief.
    expect([count(high, "full"), count(high, "brief"), count(high, "counted")]).toEqual([4, 0, 4]);
    expect([count(low, "full"), count(low, "brief"), count(low, "counted")]).toEqual([0, 8, 0]);
  });

  it("with a cap, only the top few get any form", () => {
    const out = forms([item("a", 0.9), item("b", 0.8), item("c", 0.7), item("d", 0.6)], 10_000, { most: 2 });
    expect(out.forms).toEqual({ a: "full", b: "full", c: "counted", d: "counted" });
  });

  it("the same input gives the same result, and equals keep the order they were given in", () => {
    const items = [item("x", 0.5), item("y", 0.5), item("z", 0.5)];
    expect(forms(items, 220)).toEqual(forms(items, 220));
    expect(forms(items, 220).forms).toEqual({ x: "full", y: "full", z: "brief" });
  });

  it("making room turns the lowest full item (never a must) into its brief form", () => {
    const items = [item("a", 0.9, { must: true }), item("b", 0.4), item("c", 0.6)];
    const filled = fill({ items, limit: 300, fixed: 0 });
    expect(makeRoom(filled, items)).toBe("b");
    expect(filled.forms.get("b")).toBe("brief");
    expect(filled.spent).toBe(220);
  });
});

describe("the burst", () => {
  it("news is due once for each time it is news", () => {
    const bursts = createBursts();
    const news = (...ids: string[]) => ids.map((id) => ({ id, source: id }));
    expect(bursts.due(news("a"), 0)).toEqual(["a"]);
    expect(bursts.due(news("a", "b"), 250)).toEqual(["b"]);
    expect(bursts.due(news("a"), 500)).toEqual([]);
    expect(bursts.due([], 750)).toEqual([]);
    // News again straight away: the same piece of news, not announced twice.
    expect(bursts.due(news("a"), 1000)).toEqual([]);
    // Quiet for long enough, then news again: it may burst again.
    expect(bursts.due(news("a"), 1000 + QUIET_MS + 1)).toEqual(["a"]);
  });

  it("the same kind of thing in the same rough place is one piece of news (a sound heard again and again)", () => {
    const bursts = createBursts();
    expect(bursts.due([{ id: "sound@1,2,3", source: "sound at 0,0" }], 0)).toEqual(["sound@1,2,3"]);
    expect(bursts.due([{ id: "sound@2,2,3", source: "sound at 0,0" }], 5000)).toEqual([]);
    // It keeps on, so it stays the same news however long it lasts.
    expect(bursts.due([{ id: "sound@1,2,4", source: "sound at 0,0" }], 5000 + QUIET_MS - 1)).toEqual([]);
    expect(bursts.due([{ id: "sound@9,2,9", source: "sound at 1,1" }], 5000 + QUIET_MS)).toEqual(["sound@9,2,9"]);
  });
});

describe("the planner's asks", () => {
  it("at most five count", () => {
    const asks = createAsks();
    expect(asks.active(["a", "b", "c", "d", "e", "f", "g"], new Set(), 0)).toHaveLength(ASKS.most);
  });

  it("one that matches nothing for a minute is dropped, and comes back if it matches again", () => {
    const asks = createAsks();
    expect(asks.active(["chest", "villager"], new Set(["chest"]), 0)).toEqual(["chest", "villager"]);
    expect(asks.active(["chest", "villager"], new Set(["chest"]), 59_000)).toEqual(["chest", "villager"]);
    expect(asks.active(["chest", "villager"], new Set(["chest"]), 61_000)).toEqual(["chest"]);
    expect(asks.active(["chest", "villager"], new Set(["chest", "villager"]), 70_000)).toEqual(["chest", "villager"]);
  });
});

describe("a threat in view is never only counted", () => {
  it("with no room left it still gets its brief form, and the view says by how much it went over", () => {
    const item = (id: string, over: object = {}) => ({ id, channel: "threats", priority: 0.5, cost: { full: 200, brief: 80 }, open: true, must: false, ...over });
    const filled = fill({ items: [item("husk", { floor: true }), item("cow", { channel: "creatures" })], limit: 1500, fixed: 1450 });
    expect(filled.forms.get("husk")).toBe("brief");
    expect(filled.forms.get("cow")).toBe("counted");
    expect(filled.spent).toBe(1530);
    expect(filled.over).toBe(30);
  });
});
