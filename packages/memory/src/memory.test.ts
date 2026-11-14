import { describe, expect, it } from "vitest";
import { createMemory, feelingNear, memoryNotes, STARTING_STRENGTH, type MemoryEvent, type Place } from "./memory.js";

const at = (x: number, z = 0): Place => ({ x, y: 64, z, dimension: "overworld" });
const MIN = 60_000;
const event = (over: Partial<MemoryEvent> = {}): MemoryEvent => ({
  kind: "danger",
  place: at(0),
  summary: "Took heavy damage from a zombie in plains",
  involved: ["zombie"],
  outcome: { feeling: "bad", value: -0.5 },
  ...over,
});

describe("createMemory", () => {
  it("records an event with the starting strength", () => {
    const memory = createMemory();
    const result = memory.record(event(), 1000);
    expect(result).toMatchObject({ merged: false, memory: { id: "1", time: 1000, kind: "danger", strength: STARTING_STRENGTH } });
  });

  it("merges a repeat of the same kind at the same place within a minute into one stronger memory", () => {
    const memory = createMemory();
    memory.record(event(), 0);
    const repeat = memory.record(event({ place: at(3) }), 30_000);
    expect(repeat).toMatchObject({ merged: true, memory: { id: "1" } });
    expect(repeat!.memory.strength).toBeGreaterThan(STARTING_STRENGTH);
    expect(memory.entries().memories).toHaveLength(1);
    // Elsewhere, later, another kind, or about something else is a new memory.
    memory.record(event({ place: at(100) }), 31_000);
    memory.record(event(), 5 * MIN);
    memory.record(event({ kind: "failure" }), 5 * MIN);
    memory.record(event({ involved: ["creeper"] }), 5 * MIN);
    expect(memory.entries().memories).toHaveLength(5);
  });

  it("records a first sighting only once", () => {
    const memory = createMemory();
    const cow = event({ kind: "discovery", involved: ["cow"], once: true });
    expect(memory.record(cow, 0)).not.toBeNull();
    expect(memory.record({ ...cow, place: at(500) }, 10 * MIN)).toBeNull();
    expect(memory.record({ ...cow, involved: ["pig"] }, 10 * MIN)).not.toBeNull();
  });

  it("recalls a place's memories first, then by what is involved", () => {
    const memory = createMemory();
    memory.record(event({ place: at(0), summary: "here" }), 0);
    memory.record(event({ place: at(200), summary: "far", involved: ["creeper"] }), 0);
    expect(memory.recall({ place: at(2), limit: 2 }, MIN).map((m) => m.summary)).toEqual(["here", "far"]);
    expect(memory.recall({ place: at(198), limit: 1 }, MIN)[0]!.summary).toBe("far");
    expect(memory.recall({ involving: "creeper", limit: 1 }, MIN)[0]!.summary).toBe("far");
    expect(memory.recall({ kind: "reward", limit: 5 }, MIN)).toEqual([]);
  });

  it("fades weak memories in about 2 in-game days, and strong ones much more slowly", () => {
    const memory = createMemory();
    const weak = memory.record(event({ place: at(0) }), 0)!.memory;
    const strong = memory.record(event({ place: at(500) }), 0)!.memory;
    memory.tag(strong.id, 0.8, 0);
    const later = memory.recall({ limit: 2, touch: false }, 40 * MIN);
    expect(later.find((m) => m.id === weak.id)!.strength).toBeCloseTo(STARTING_STRENGTH / 2);
    expect(later.find((m) => m.id === strong.id)!.strength).toBeGreaterThan(0.75);
  });

  it("strengthens a memory a little each time it is recalled, unless only looking", () => {
    const memory = createMemory();
    memory.record(event(), 0);
    memory.recall({ limit: 1, touch: false }, 0);
    expect(memory.recall({ limit: 1 }, 0)[0]!.strength).toBeCloseTo(STARTING_STRENGTH + 0.05);
  });

  it("drops the weakest memory when the store is full", () => {
    const memory = createMemory({ capacity: 2 });
    const old = memory.record(event({ place: at(0), summary: "weak old" }), 0)!.memory;
    const strong = memory.record(event({ place: at(100), summary: "strong" }), 0)!.memory;
    memory.tag(strong.id, 0.8, 0);
    memory.record(event({ place: at(200), summary: "new" }), 60 * MIN);
    const kept = memory.entries().memories.map((m) => m.summary);
    expect(kept).toEqual(["strong", "new"]);
    expect(kept).not.toContain(old.summary);
  });

  it("lists named places, plus one entry per spot with a strong memory", () => {
    const memory = createMemory();
    memory.namePlace("base chest", at(10));
    const weak = memory.record(event({ place: at(0) }), 0)!.memory;
    expect(memory.knownPlaces(0)).toEqual([{ name: "base chest", place: at(10) }]);
    memory.tag(weak.id, 0.8, 0);
    expect(memory.knownPlaces(0)).toEqual([
      { name: "base chest", place: at(10) },
      { name: "danger: zombie", place: at(0), kind: "danger" },
    ]);
  });

  it("saves and restores the same memories and places", () => {
    const memory = createMemory();
    memory.namePlace("bed", at(5));
    memory.record(event(), 1000);
    memory.record(event({ kind: "reward", place: at(50), outcome: { feeling: "good", value: 0.6 } }), 2000);
    const restored = createMemory({ saved: memory.entries() });
    expect(restored.entries()).toEqual(memory.entries());
    expect(restored.record(event({ place: at(900) }), 5 * MIN)!.memory.id).toBe("3");
  });
});

describe("feelingNear", () => {
  it("is the strongest good or bad memory close by, without counting as a recall", () => {
    const memory = createMemory();
    expect(feelingNear(memory, at(0), 0)).toBeNull();
    memory.record(event({ kind: "discovery", outcome: { feeling: "neutral", value: 0 } }), 0);
    expect(feelingNear(memory, at(0), 0)).toBeNull();
    memory.record(event({ place: at(10) }), 0);
    expect(feelingNear(memory, at(0), 0)).toEqual({ nearby: "bad", kind: "danger" });
    expect(feelingNear(memory, at(100), 0)).toBeNull();
    expect(memory.entries().memories[1]!.strength).toBe(STARTING_STRENGTH);
  });
});

describe("memoryNotes", () => {
  it("gives the planner the most relevant memories as sentences, and the known places", () => {
    const memory = createMemory();
    memory.namePlace("bed", at(5));
    memory.record(event(), 0);
    expect(memoryNotes(memory, at(0), 0)).toEqual(["Memories:", "- Took heavy damage from a zombie in plains (at 0,64,0)", "Known places:", "- bed at 5,64,0"]);
    expect(memoryNotes(createMemory(), at(0), 0)).toEqual([]);
  });
});

describe("consolidation", () => {
  const night = (x: number, involved = ["zombie"]) => event({ place: at(x), involved, context: ["night"] });

  it("prune drops memories that have faded to almost nothing", () => {
    const memory = createMemory();
    memory.record(event({ place: at(0) }), 0);
    const strong = memory.record(event({ place: at(500) }), 0)!.memory;
    memory.tag(strong.id, 0.8, 0);
    expect(memory.consolidate("prune", 10 * MIN)).toBe(0);
    expect(memory.consolidate("prune", 200 * MIN)).toBe(1);
    expect(memory.entries().memories.map((m) => m.id)).toEqual([strong.id]);
  });

  it("merge folds near-duplicates into one stronger memory", () => {
    const memory = createMemory();
    memory.record(event({ place: at(0) }), 0);
    memory.record(event({ place: at(4) }), 5 * MIN); // same spot, too late to merge when recorded
    memory.record(event({ place: at(300) }), 5 * MIN);
    expect(memory.consolidate("merge", 6 * MIN)).toBe(1);
    const left = memory.entries().memories;
    expect(left).toHaveLength(2);
    expect(left[0]!.strength).toBeGreaterThan(STARTING_STRENGTH);
  });

  it("generalise turns three matching memories into one fact, built from the pattern", () => {
    const memory = createMemory();
    for (const x of [0, 100, 200]) memory.record(night(x), 0);
    expect(memory.consolidate("generalise", 0)).toBe(1);
    expect(memory.facts({ limit: 5 })).toEqual([
      { id: expect.any(String), text: "zombie is dangerous at night", kind: "danger", involved: "zombie", feeling: "bad", context: ["night"], support: 3, confidence: 0.5 },
    ]);
    // Running it again writes nothing new.
    expect(memory.consolidate("generalise", 0)).toBe(0);
  });

  it("needs enough agreeing memories, and keeps only the circumstances they all share", () => {
    const memory = createMemory();
    memory.record(night(0), 0);
    memory.record(night(100), 0);
    expect(memory.consolidate("generalise", 0)).toBe(0);
    memory.record(event({ place: at(200), context: ["day"] }), 0);
    memory.consolidate("generalise", 0);
    expect(memory.facts({ limit: 1 })[0]!.text).toBe("zombie is dangerous");
    // A cautious bot needs more.
    expect(createMemory({ saved: memory.entries() }).consolidate("generalise", 0, 5)).toBe(0);
  });

  it("grows a fact's confidence with more support", () => {
    const memory = createMemory();
    for (const x of [0, 100, 200]) memory.record(night(x), 0);
    memory.consolidate("generalise", 0);
    for (const x of [300, 400, 500]) memory.record(night(x), 0);
    memory.consolidate("generalise", 0);
    expect(memory.facts({ limit: 1 })[0]).toMatchObject({ support: 6, confidence: 0.75 });
  });

  it("guardrail: a contradicting memory lowers a fact's confidence, and enough of them delete it", () => {
    const memory = createMemory();
    for (const x of [0, 100, 200]) memory.record(night(x), 0);
    memory.consolidate("generalise", 0);
    const friendly = (x: number) => event({ kind: "reward", place: at(x), involved: ["zombie"], outcome: { feeling: "good", value: 0.5 } });
    memory.record(friendly(1000), 0);
    expect(memory.facts({ limit: 1 })[0]!.confidence).toBeCloseTo(0.3);
    memory.record(friendly(2000), 0);
    expect(memory.facts({ limit: 1 })).toEqual([]);
  });

  it("gives the planner the top facts alongside memories, and saves them", () => {
    const memory = createMemory();
    for (const x of [0, 100, 200]) memory.record(night(x), 0);
    memory.consolidate("generalise", 0);
    expect(memoryNotes(memory, at(0), 0, 1)).toEqual(expect.arrayContaining(["Learned from experience:", "- zombie is dangerous at night"]));
    expect(createMemory({ saved: memory.entries() }).facts({ limit: 5 })).toEqual(memory.facts({ limit: 5 }));
  });
});
