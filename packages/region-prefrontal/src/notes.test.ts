import { describe, expect, it } from "vitest";
import type { Plan, Planner, PlanRequest } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { createNotes, MOST_NOTES, parseNotes, UNKEPT_PLANS } from "./notes.js";
import { createPrefrontalRegion } from "./prefrontal-region.js";

const note = (key: string, text = `about ${key}`) => ({ key, text });
const keys = (notes: { list(): { key: string }[] }) => notes.list().map((n) => n.key);

describe("the planner's notes", () => {
  it("a plan adds notes, keeps one by saying it again, changes one by giving new text, and drops one by name", () => {
    const notes = createNotes();
    expect(notes.plan([note("ledge", "cannot be reached"), note("chest")])).toMatchObject({ added: ["ledge", "chest"] });
    const change = notes.plan([note("ledge", "cannot be reached"), note("chest", "empty now"), note("bed")], ["nothing-like-it"]);
    expect(change).toEqual({ kept: ["ledge"], changed: ["chest"], added: ["bed"], dropped: [], lapsed: [], refused: [] });
    expect(notes.list()).toEqual([{ key: "ledge", text: "cannot be reached", unkept: 0 }, { key: "chest", text: "empty now", unkept: 0 }, { key: "bed", text: "about bed", unkept: 0 }]);
    expect(notes.plan([note("ledge", "cannot be reached"), note("bed")], ["chest"]).dropped).toEqual(["chest"]);
    // A note given back with no text is one to drop.
    expect(notes.plan([note("ledge", "cannot be reached"), note("bed", "  ")]).dropped).toEqual(["bed"]);
    expect(keys(notes)).toEqual(["ledge"]);
  });

  it("holds at most five: a sixth is refused until there is room", () => {
    const notes = createNotes();
    const five = ["a", "b", "c", "d", "e"].map((k) => note(k));
    expect(notes.plan([...five, note("f"), note("g")])).toMatchObject({ added: ["a", "b", "c", "d", "e"], refused: ["f", "g"] });
    expect(notes.list()).toHaveLength(MOST_NOTES);
    // Dropping one in the same plan makes room for a new one.
    expect(notes.plan([...five.slice(1), note("f")], ["a"])).toMatchObject({ dropped: ["a"], added: ["f"], refused: [] });
    expect(keys(notes)).toEqual(["b", "c", "d", "e", "f"]);
  });

  it("a note not kept for three plans in a row is dropped; keeping it once starts the count again", () => {
    const notes = createNotes();
    notes.plan([note("ledge"), note("chest")]);
    for (let i = 1; i < UNKEPT_PLANS; i++) expect(notes.plan([note("chest")]).lapsed).toEqual([]);
    expect(notes.list().find((n) => n.key === "ledge")!.unkept).toBe(2);
    notes.plan([note("ledge"), note("chest")]);
    expect(notes.list().find((n) => n.key === "ledge")!.unkept).toBe(0);
    notes.plan([]);
    notes.plan([]);
    expect(notes.plan([])).toMatchObject({ lapsed: ["ledge", "chest"] });
    expect(notes.list()).toEqual([]);
  });

  it("notes are short, one per key, and a saved file is read with care", () => {
    const notes = createNotes();
    notes.plan([note("  The   ledge ", "x".repeat(500)), note("The ledge", "second word wins")]);
    expect(notes.list()).toEqual([{ key: "The ledge", text: "second word wins", unkept: 0 }]);
    expect(createNotes(notes.entries()).list()).toEqual(notes.list());
    expect(parseNotes([{ key: "a", text: "t", unkept: 2 }, { key: "a", text: "again" }, { key: "", text: "t" }, { key: "b" }, null, 3])).toEqual([{ key: "a", text: "t", unkept: 2 }]);
    expect(parseNotes({ not: "a list" })).toEqual([]);
    expect(parseNotes(Array.from({ length: 9 }, (_, i) => note(`n${i}`)))).toHaveLength(MOST_NOTES);
    expect(createNotes([note("long", "y".repeat(500))]).list()[0]!.text).toHaveLength(200);
  });
});

describe("the prefrontal region with notes", () => {
  const signal = new AbortController().signal;
  function setUp(plans: Plan[], store = createWorkspace()) {
    const requests: PlanRequest[] = [];
    let at = 0;
    const planner: Planner = { name: "fixed", plan: async (request) => (requests.push(request), plans[Math.min(at++, plans.length - 1)]!) };
    const notes = createNotes();
    const region = createPrefrontalRegion({ planner, describe: () => "s", notes });
    return { store, notes, requests, plan: () => region.run(store.viewFor("prefrontal"), signal) };
  }
  const plan = (more: Partial<Plan> = {}): Plan => ({ goal: "g", steps: [], reason: "", ...more });

  it("shows the planner its notes each time, and the trace says what each plan did to them", async () => {
    const p = setUp([plan({ notes: [note("ledge", "cannot be reached")] }), plan({ notes: [note("ledge", "cannot be reached"), note("chest", "try the chest")] }), plan({ dropNotes: ["ledge"] })]);
    expect((await p.plan()).trace).toMatchObject({ notes: { added: ["ledge"], now: ["ledge"] } });
    expect(p.requests[0]!.notes).toEqual([]);
    expect((await p.plan()).trace).toMatchObject({ notes: { kept: ["ledge"], added: ["chest"], now: ["ledge", "chest"] } });
    expect(p.requests[1]!.notes).toEqual([{ key: "ledge", text: "cannot be reached" }]);
    expect((await p.plan()).trace!.notes).toEqual({ dropped: ["ledge"], now: ["chest"] });
    expect(p.requests[2]!.notes).toEqual([{ key: "ledge", text: "cannot be reached" }, { key: "chest", text: "try the chest" }]);
  });

  it("while a protected goal keeps the plan out, the notes are held as they are: nothing is added, dropped or counted", async () => {
    let safe = false;
    const store = createWorkspace({ goalGate: (_offered, standing) => (standing.protected && !safe ? "protected" : null) });
    const p = setUp([plan({ notes: [note("ledge")] }), plan({ notes: [note("new")], dropNotes: ["ledge"] })], store);
    await p.plan();
    store.viewFor("noradrenaline").setGoal({ text: "Retreat.", steps: [], reason: "", protected: true });
    for (let i = 0; i < 5; i++) expect((await p.plan()).trace).toMatchObject({ goalKept: "protected", notes: { held: true } });
    expect(p.notes.list()).toEqual([{ key: "ledge", text: "about ledge", unkept: 0 }]);
    // The retreat over, the next plan's word on the notes counts again.
    safe = true;
    await p.plan();
    expect(keys(p.notes)).toEqual(["new"]);
  });

  it("with no notes kept, the planner is shown none and the trace has none", async () => {
    const requests: PlanRequest[] = [];
    const planner: Planner = { name: "fixed", plan: async (request) => (requests.push(request), plan({ notes: [note("x")] })) };
    const { trace } = await createPrefrontalRegion({ planner, describe: () => "" }).run(createWorkspace().viewFor("prefrontal"), signal);
    expect(requests[0]!.notes).toBeUndefined();
    expect(trace!.notes).toBeUndefined();
  });
});
