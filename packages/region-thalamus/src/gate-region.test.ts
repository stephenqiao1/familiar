import type { State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { describe, expect, it } from "vitest";
import type { Form, Split } from "./item.js";
import { DEFAULT_THALAMUS, THALAMUS_OFF, type ThalamusSettings } from "./settings.js";
import { BURST_SIGNAL } from "./signals.js";
import { createThalamusRegion, type ThalamusOptions } from "./thalamus-region.js";

// The gate as a whole, on a made-up state: a list of things, each in a channel.

const signal = new AbortController().signal;
interface Thing {
  id: string;
  kind: string;
  channel: string;
  dist?: number;
  fresh?: boolean;
  threat?: number;
  vital?: boolean;
}
const FULL = 100;
const BRIEF = 20;
const FIXED = 200;
const state = (things: Thing[], timestamp = 0): State => ({ schemaVersion: 1, tick: 0, timestamp, data: { things } });
/** The made-up game: each thing costs 100 in full and 20 in brief; the rest of the state costs 200. */
const split = (s: State): Split => {
  const things = s.data.things as Thing[];
  const names = [...new Set(things.map((t) => t.channel))];
  return {
    channels: names.map((name) => ({ name, base: 0.3, items: things.filter((t) => t.channel === name).map((t) => ({ ...t, cost: { full: FULL, brief: BRIEF } })) })),
    fixed: FIXED,
    assemble: (forms, note) => ({ ...s, data: { things: things.flatMap((t) => (forms.get(t.id) === "counted" ? [] : [{ ...t, form: forms.get(t.id) }])), told: note } }),
  };
};
type Shown = { id: string; form: Form }[];

function thalamus(settings: Partial<ThalamusSettings> = {}, over: Partial<ThalamusOptions> = {}) {
  const store = createWorkspace();
  // No shape or size unless a test asks: focus and arousal sit at 0.5.
  const region = createThalamusRegion({ readers: ["instinct", "prefrontal"], settings: { ...DEFAULT_THALAMUS, limits: { instinct: 500, prefrontal: 1000 }, ...settings }, split, trim: (s, n) => ({ ...s, data: { things: (s.data.things as Thing[]).slice(0, n) } }), ...over });
  let ms = 0;
  const tick = (things: Thing[], current: { skill: string; target?: string } | null = null) => {
    ms += 500;
    store.update(state(things, ms), current ? { skill: current.skill, target: current.target, startedAt: 0 } : null);
    const out = region.run(store.viewFor("thalamus"), signal) as { trace: Record<string, any> };
    const view = (reader: string) => store.viewFor(reader).view(reader);
    const shown = (reader = "instinct") => Object.fromEntries((view(reader).data.things as Shown).map((t) => [t.id, t.form]));
    return { ...out, view, shown, told: (reader = "instinct") => view(reader).data.told as { heldBack: Record<string, number>; new: string[] } };
  };
  return { store, tick, value: (name: string) => store.signals()[name]?.value };
}
const cow = (i: number, over: Partial<Thing> = {}): Thing => ({ id: `cow${i}`, kind: "cow", channel: "creatures", dist: 10, ...over });
const herd = Array.from({ length: 6 }, (_, i) => cow(i));

describe("the gate", () => {
  it("a turned-down channel gives brief forms and counts, never a full one; the view says what it held back", () => {
    const { tick } = thalamus({ shape: 0 });
    const out = tick([...herd, ...Array.from({ length: 20 }, (_, i) => cow(i + 6))]);
    // 300 of room for instinct: fifteen in brief, the other eleven counted.
    expect(Object.values(out.shown())).not.toContain("full");
    expect(Object.keys(out.shown())).toHaveLength(15);
    expect(out.told().heldBack).toEqual({ creatures: 11 });
    expect(out.trace.views.instinct).toMatchObject({ limit: 500, spent: 500, channels: { creatures: { open: false, full: 0, brief: 15, counted: 11 } } });
    // The planner has a bigger view: all twenty-six in brief.
    expect(Object.keys(out.shown("prefrontal"))).toHaveLength(26);
  });

  it("each opener opens its channel: the attended thing, the skill's target, a threat in view, a wanted thing, a watched kind, an ask", () => {
    const openedBy = (act: (t: ReturnType<typeof thalamus>) => ReturnType<ReturnType<typeof thalamus>["tick"]>, t = thalamus({ shape: 0 })) => act(t).trace.views.instinct.channels.creatures.open;
    expect(openedBy((t) => t.tick(herd))).toBe(false);
    expect(openedBy((t) => (t.store.viewFor("colliculus").setAttended({ id: "cow2", kind: "cow", bearing: "left", salience: 1, since: 0 }), t.tick(herd)))).toBe("the attended thing");
    expect(openedBy((t) => t.tick(herd, { skill: "attack", target: "cow3" }))).toBe("the running skill's target");
    expect(openedBy((t) => t.tick(herd, { skill: "look_at", target: "cow3" }), thalamus({ shape: 0 }, { lookSkill: "look_at" }))).toBe(false);
    expect(openedBy((t) => t.tick([...herd.slice(1), cow(0, { threat: 2 })]))).toBe("a threat in view");
    expect(openedBy((t) => t.tick([...herd.slice(1), cow(0, { threat: 1 })]))).toBe("a threat in view");
    expect(openedBy((t) => t.tick(herd), thalamus({ shape: 0 }, { wantOf: (kind) => (kind === "cow" ? 0.6 : 0) }))).toBe("a wanted thing");
    expect(openedBy((t) => (t.store.viewFor("prefrontal").setGoal({ text: "g", steps: [], reason: "", watchFor: ["cow"] }), t.tick(herd)))).toBe("the goal asks for it");
    expect(openedBy((t) => (t.store.viewFor("prefrontal").setGoal({ text: "g", steps: [], reason: "", detail: ["cow"] }), t.tick(herd)))).toBe("the goal asks for it");
  });

  it("the attended thing is told in full; the same thing, unattended, is brief", () => {
    const t = thalamus({ shape: 0 });
    expect(t.tick(herd).shown().cow2).toBe("brief");
    t.store.viewFor("colliculus").setAttended({ id: "cow2", kind: "cow", bearing: "left", salience: 1, since: 0 });
    const out = t.tick(herd);
    expect(out.shown().cow2).toBe("full");
    expect(out.trace.views.instinct.items[0]).toMatchObject({ id: "cow2", form: "full", by: ["attended", "near"] });
  });

  it("a wanted kind is told in full; with nothing wanted it is brief or counted", () => {
    let hungry = true;
    const t = thalamus({ shape: 0 }, { wantOf: (kind) => (hungry && kind === "chest" ? 0.9 : 0) });
    const things = [...herd, { id: "chest", kind: "chest", channel: "things", dist: 12 }];
    expect(t.tick(things).shown().chest).toBe("full");
    hungry = false;
    expect(t.tick(things).shown().chest).not.toBe("full");
  });
});

describe("focus and arousal", () => {
  const open = (focus: number, arousal = 0.5) => {
    const t = thalamus({}, { wantOf: () => 0.5, focusOf: () => focus, arousalOf: () => arousal });
    return t.tick([...herd, ...Array.from({ length: 10 }, (_, i) => cow(i + 6))]);
  };
  const count = (out: ReturnType<typeof open>, form: string) => Object.values(out.shown()).filter((f) => f === form).length;

  it("focus changes the shape: high, few things in full; low, many things in brief", () => {
    const [high, low] = [open(1), open(0)];
    expect([count(high, "full"), count(high, "brief")]).toEqual([3, 0]);
    expect([count(low, "full"), count(low, "brief")]).toEqual([0, 15]);
    expect(high.told().heldBack.creatures).toBe(13);
  });

  it("arousal changes the size: drowsy, about a third; over-aroused, only the top few", () => {
    expect(open(0.5, 0.5).trace.views.instinct.limit).toBe(500);
    expect(open(0.5, 0.2).trace.views.instinct.limit).toBe(167);
    const frazzled = open(0.5, 0.95);
    expect(frazzled.trace.views.instinct.limit).toBe(500);
    expect(Object.keys(frazzled.shown())).toHaveLength(3);
  });

  it("a paused reader gets no view built", () => {
    const t = thalamus({}, { paused: (reader) => reader === "instinct" });
    const out = t.tick(herd);
    expect(out.trace.views.instinct).toEqual({ paused: true });
    expect(out.view("instinct")).toBe(t.store.viewFor("x").state);
    expect(out.trace.views.prefrontal.limit).toBe(1000);
  });
});

describe("the burst", () => {
  const crowd = Array.from({ length: 30 }, (_, i) => cow(i));

  it("a new thing in a turned-down channel is shown once, in brief, marked new, then counted again", () => {
    const t = thalamus({ shape: 0 });
    t.tick(crowd);
    const first = t.tick([...crowd, cow(99, { fresh: true, dist: 16 })]);
    expect(first.shown().cow99).toBe("brief");
    expect(first.told().new).toEqual(["cow99"]);
    expect(first.trace.views.instinct.bursts).toEqual(["cow99"]);
    // Still news on the next tick: it was announced already, so it is not marked again.
    expect(t.tick([...crowd, cow(99, { fresh: true, dist: 16 })]).told().new).toEqual([]);
    // No longer news, and nothing gives it priority: it is counted like the rest.
    const later = t.tick([...crowd, cow(99, { dist: 16 })]);
    expect(later.shown().cow99).toBeUndefined();
    expect(later.told().heldBack.creatures).toBe(16);
  });

  it("with the budget full it makes room by dropping the lowest full item to brief", () => {
    // The news is something the bot is used to, so by priority it would only be counted.
    const t = thalamus({ shape: 0 }, { wantOf: (kind) => (kind === "chest" ? 0.5 : 0), usedTo: (item) => (item.id === "cow99" ? 1 : 0) });
    const chests = Array.from({ length: 3 }, (_, i) => ({ id: `chest${i}`, kind: "chest", channel: "things", dist: 10 + i }));
    const out = t.tick([...chests, cow(99, { fresh: true, dist: 16 })]);
    // Three chests in full use the 300 of room; the news gets in by the furthest chest giving way.
    expect(out.shown()).toEqual({ chest0: "full", chest1: "full", chest2: "brief", cow99: "brief" });
    expect(out.trace.views.instinct.gaveWay).toEqual(["chest2"]);
  });

  it("news in an open channel is not a burst: it is weighed like anything else", () => {
    const t = thalamus({ shape: 0 }, { wantOf: () => 0.5 });
    const out = t.tick([cow(1), cow(99, { fresh: true })]);
    expect(out.told().new).toEqual([]);
    expect(out.shown().cow99).toBe("full");
  });

  it("a burst for something strong sets the `burst` signal for the tick; a weak one does not", () => {
    let orienting = 0.8;
    const t = thalamus({ shape: 0 }, { orientingOf: () => orienting });
    t.tick([...crowd, cow(99, { fresh: true, dist: 16 })]);
    expect(t.value(BURST_SIGNAL)).toBe(1);
    t.tick(crowd);
    expect(t.value(BURST_SIGNAL)).toBe(0);
    orienting = 0.3;
    t.tick([...crowd, cow(98, { fresh: true, dist: 16 })]);
    expect(t.value(BURST_SIGNAL)).toBe(0);
    // With the burst off, nothing is announced and the signal is never written.
    const off = thalamus({ shape: 0, burst: 0 }, { orientingOf: () => 1 });
    expect(off.tick([...crowd, cow(99, { fresh: true, dist: 16 })]).told().new).toEqual([]);
    expect(off.value(BURST_SIGNAL)).toBeUndefined();
  });
});

describe("what is never held back", () => {
  it("the attended thing, the skill's target, a pressing threat and a vital hazard survive a tiny limit, and the overrun is logged", () => {
    const t = thalamus({ limits: { instinct: 50, prefrontal: 50 } });
    t.store.viewFor("colliculus").setAttended({ id: "seen", kind: "cow", bearing: "left", salience: 1, since: 0 });
    const things = [...herd, cow(50, { id: "seen" }), cow(51, { id: "aimed" }), cow(52, { id: "coming", threat: 2, channel: "threats" }), { id: "lava", kind: "lava", channel: "hazards", dist: 2, vital: true }];
    const out = t.tick(things, { skill: "attack", target: "aimed" });
    expect(out.shown()).toEqual({ seen: "full", aimed: "full", coming: "full", lava: "brief" });
    expect(out.trace.views.instinct.over).toBeGreaterThan(0);
    expect(out.trace.views.instinct.warning).toMatch(/over the limit/);
    expect(out.told().heldBack).toEqual({ creatures: 6 });
  });
});

describe("the planner's asks", () => {
  const things = [...herd, { id: "chest", kind: "chest", channel: "things", dist: 12 }];
  const ask = (t: ReturnType<typeof thalamus>, detail: string[]) => t.store.viewFor("prefrontal").setGoal({ text: "g", steps: [], reason: "", detail });

  it("a kind or an id the goal asks for opens its channel and is told in full", () => {
    const t = thalamus({ shape: 0 });
    expect(t.tick(things).shown("prefrontal").chest).toBe("brief");
    ask(t, ["chest"]);
    const out = t.tick(things);
    expect(out.shown("prefrontal").chest).toBe("full");
    expect(out.trace.asks).toEqual(["chest"]);
    ask(t, ["cow3"]);
    expect(t.tick(things).shown("prefrontal").cow3).toBe("full");
  });

  it("only five count, and one that matches nothing for a minute is dropped", () => {
    const t = thalamus({ shape: 0 });
    ask(t, ["a", "b", "c", "d", "e", "chest"]);
    expect(t.tick(things).trace.asks).toEqual(["a", "b", "c", "d", "e"]);
    ask(t, ["chest", "villager"]);
    expect(t.tick(things).trace.asks).toEqual(["chest", "villager"]);
    for (let i = 0; i < 125; i++) t.tick(things);
    expect(t.tick(things).trace.asks).toEqual(["chest"]);
  });

  it("an area's ask is read in place of the goal's detail, and every reader's asks count once", () => {
    const t = thalamus({ shape: 0 });
    ask(t, ["cow3"]);
    t.store.viewFor("prefrontal").setCortex("prefrontal", { ask: ["chest"] });
    t.store.viewFor("instinct").setCortex("instinct", { ask: ["chest"] });
    const out = t.tick(things);
    expect(out.trace.asks).toEqual(["chest"]);
    expect(out.shown("prefrontal").chest).toBe("full");
  });

  it("with detail at 0 an ask does nothing", () => {
    const t = thalamus({ shape: 0, detail: 0 });
    ask(t, ["chest"]);
    expect(t.tick(things).shown("prefrontal").chest).toBe("brief");
  });
});

describe("guardrails", () => {
  it("the same inputs give the same view twice", () => {
    const run = () => {
      const t = thalamus({}, { wantOf: (kind) => (kind === "chest" ? 0.4 : 0), focusOf: () => 0.7 });
      t.tick(herd);
      return t.tick([...herd, { id: "chest", kind: "chest", channel: "things", dist: 12 }, cow(99, { fresh: true })]);
    };
    expect(run().view("instinct")).toEqual(run().view("instinct"));
    expect(run().trace.views).toEqual(run().trace.views);
  });

  it("every strength at 0 gives the view by count alone", () => {
    const t = thalamus(THALAMUS_OFF, { nearby: () => 4 });
    const out = t.tick(herd);
    expect((out.view("instinct").data.things as Thing[]).map((x) => x.id)).toEqual(["cow0", "cow1", "cow2", "cow3"]);
    expect(out.view("instinct").data.told).toBeUndefined();
    expect(out.trace).toMatchObject({ nearby: 4 });
  });

  it("stays under 2 ms a tick with a hundred items", () => {
    const t = thalamus({}, { wantOf: () => 0.3 });
    const many = Array.from({ length: 100 }, (_, i) => cow(i, { channel: i % 3 ? "creatures" : "things", fresh: i % 7 === 0 }));
    t.tick(many);
    const started = performance.now();
    for (let i = 0; i < 100; i++) t.tick(many);
    expect((performance.now() - started) / 100).toBeLessThan(2);
  });
});

describe("the sensory area's part", () => {
  const crowd = Array.from({ length: 30 }, (_, i) => cow(i));

  it("a thing the sensory area calls unexpected counts as new: it bursts once like a thing that just appeared, and is not counted twice", () => {
    const strange = new Set<string>();
    const t = thalamus({ shape: 0 }, { unexpected: (item) => strange.has(item.id) });
    t.tick([...crowd, cow(99, { dist: 16 })]);
    expect(t.tick([...crowd, cow(99, { dist: 16 })]).shown().cow99).toBeUndefined();
    strange.add("cow99");
    const first = t.tick([...crowd, cow(99, { dist: 16 })]);
    expect(first.shown().cow99).toBe("brief");
    expect(first.told().new).toEqual(["cow99"]);
    // Unexpected and just appeared at once is the same news: the priority is what either gives alone.
    const priority = (out: { trace: Record<string, any> }, id: string) => (out.trace.views.prefrontal.items as { id: string; priority: number; by: string[] }[]).find((i) => i.id === id);
    const [alone, both] = [thalamus({ shape: 0 }, { unexpected: () => true }), thalamus({ shape: 0 }, { unexpected: () => true })];
    expect(priority(both.tick([cow(1, { fresh: true })]), "cow1")).toEqual(priority(alone.tick([cow(1)]), "cow1"));
    expect(priority(alone.tick([cow(1)]), "cow1")!.by).toContain("fresh");
  });

  it("a reader told everything gets the whole state, with no gate or budget, beside the others' views", () => {
    const t = thalamus({}, { whole: ["sensory"] });
    const out = t.tick(crowd);
    expect((out.view("sensory").data.things as unknown[]).length).toBe(30);
    expect(Object.keys(out.shown("instinct")).length).toBeLessThan(30);
    expect(Object.keys(out.trace.views)).toEqual(["instinct", "prefrontal"]);
  });
});

