import { describe, expect, it } from "vitest";
import { createWorkspace } from "@familiar/core";
import { createChangeable } from "./changeable.js";
import { createCingulateRegion, WAKE_GAP_MS, type CingulateOptions } from "./cingulate-region.js";
import { BASE_CHANCE, chanceOf, controlOf, costOf, LEAVE_IT, rateScale, REFLEX_HAS_IT, stakeOf, verdictOf } from "./control.js";
import { createLeave, FOR_A_WHILE_MS, JUDGED_AFTER_MS, payOf } from "./leave.js";
import { cingulateProblem, DEFAULT_CINGULATE, NO_CINGULATE, SHADOW_CINGULATE } from "./settings.js";
import { createTrouble, SAME_EVENT_MS } from "./trouble.js";

describe("trouble", () => {
  const sources = ["conflict", "mismatch", "unexpected", "stuck step", "bad surprise", "pain", "uneasy", "stuck", "slow progress"];

  it("each source raises it, and it fades when the source does", () => {
    for (const name of sources) {
      const trouble = createTrouble();
      expect(trouble.tick([{ name, strength: 0 }], 0)).toEqual({ level: 0, events: [] });
      expect(trouble.tick([{ name, strength: 0.6 }], 500)).toEqual({ level: 0.6, events: [{ kinds: [name], about: [], strength: 0.6, age: 0 }] });
      expect(trouble.tick([{ name, strength: 0.3 }], 1000)).toMatchObject({ level: 0.3, events: [{ strength: 0.3, age: 500 }] });
      expect(trouble.tick([{ name, strength: 0.07 }], 1500).level).toBeCloseTo(0.07);
      expect(trouble.tick([{ name, strength: 0 }], 2000)).toEqual({ level: 0, events: [] });
    }
  });

  it("three sources from one event count once: one event with three faces, as strong as its strongest", () => {
    const trouble = createTrouble();
    trouble.tick([{ name: "mismatch", strength: 0.6, about: ["go_to", "entity:7"] }], 1000);
    trouble.tick([{ name: "mismatch", strength: 0.6, about: ["go_to", "entity:7"] }, { name: "unexpected", strength: 0.5, about: ["entity:7", "pig"] }], 1500);
    const { level, events } = trouble.tick([{ name: "mismatch", strength: 0.6, about: ["go_to", "entity:7"] }, { name: "unexpected", strength: 0.5, about: ["entity:7", "pig"] }, { name: "bad surprise", strength: 0.4 }], 2000);
    expect(events).toEqual([{ kinds: ["mismatch", "unexpected", "bad surprise"], about: ["go_to", "entity:7", "pig"], strength: 0.6, age: 1000 }]);
    expect(level).toBe(0.6);
  });

  it("sources about different things, or more than a second apart, are separate events: two events are more trouble than one", () => {
    const apart = createTrouble();
    apart.tick([{ name: "mismatch", strength: 0.5, about: ["go_to"] }], 0);
    const two = apart.tick([{ name: "mismatch", strength: 0.5, about: ["go_to"] }, { name: "pain", strength: 0.5, about: ["body"] }], 500);
    expect(two.events.map((e) => e.kinds)).toEqual([["mismatch"], ["pain"]]);
    expect(two.level).toBeCloseTo(0.75);
    const later = createTrouble();
    later.tick([{ name: "mismatch", strength: 0.5 }], 0);
    expect(later.tick([{ name: "mismatch", strength: 0.5 }, { name: "pain", strength: 0.5 }], SAME_EVENT_MS + 500).events).toHaveLength(2);
  });

  it("a face goes when its source does, the event when its last face has; a source that rises again is a new event", () => {
    const trouble = createTrouble();
    trouble.tick([{ name: "mismatch", strength: 0.6 }, { name: "pain", strength: 0.8 }], 0);
    expect(trouble.tick([{ name: "mismatch", strength: 0.6 }, { name: "pain", strength: 0 }], 500).events).toMatchObject([{ kinds: ["mismatch"], strength: 0.6 }]);
    expect(trouble.tick([{ name: "mismatch", strength: 0 }, { name: "pain", strength: 0 }], 1000).events).toEqual([]);
    expect(trouble.tick([{ name: "mismatch", strength: 0.6 }, { name: "pain", strength: 0 }], 9000).events).toMatchObject([{ kinds: ["mismatch"], age: 0 }]);
  });
});

describe("is more effort worth it?", () => {
  const calm = { calls: 0, budget: 200, tired: 0, stress: 0 };

  it("control rises with the stake and with the chance, and falls with the cost", () => {
    expect(controlOf(1, 1, 1, 0)).toBe(1);
    expect(controlOf(0.8, 0.5, 1, 0)).toBeCloseTo(0.4);
    expect(controlOf(0.8, 1, 1, 0)).toBeGreaterThan(controlOf(0.8, 0.5, 1, 0));
    expect(controlOf(0.8, 1, 1, 0)).toBeGreaterThan(controlOf(0.8, 1, 0.3, 0));
    expect(controlOf(0.8, 1, 1, 0.3)).toBeCloseTo(0.5);
    expect(controlOf(0.2, 1, 1, 0.5)).toBe(0);
    expect(controlOf(0, 1, 1, 0)).toBe(0);
  });

  it("the stake is the most of the need, the goal and the skill, lowered a little by a low mood", () => {
    expect(stakeOf({ need: 0.2, goal: 0.5, skill: 0.9 })).toBe(0.9);
    expect(stakeOf({ need: 0, goal: 0, skill: 0 })).toBe(0);
    expect(stakeOf({ need: 1, goal: 0, skill: 0 }, -1, 1)).toBeCloseTo(0.8);
    expect(stakeOf({ need: 1, goal: 0, skill: 0 }, -0.5, 1)).toBeCloseTo(0.9);
    // A good mood does not raise it, and with the strength at 0 mood does nothing.
    expect(stakeOf({ need: 1, goal: 0, skill: 0 }, 1, 1)).toBe(1);
    expect(stakeOf({ need: 1, goal: 0, skill: 0 }, -1, 0)).toBe(1);
  });

  it("the chance is high with close options, a little-known option or an unfamiliar thing, and low when a reflex has it", () => {
    const none = { close: 0, unknown: 0, unfamiliar: 0, reflex: false };
    expect(chanceOf(none)).toBe(BASE_CHANCE);
    for (const key of ["close", "unknown", "unfamiliar"] as const) expect(chanceOf({ ...none, [key]: 1 })).toBe(1);
    expect(chanceOf({ ...none, close: 0.5 })).toBeCloseTo(0.65);
    expect(chanceOf({ ...none, close: 1, reflex: true })).toBeCloseTo(REFLEX_HAS_IT);
  });

  it("the cost is small until the budget is nearly spent, and rises with tiredness and with high stress", () => {
    expect(costOf(calm)).toBe(0);
    expect(costOf({ ...calm, calls: 100 })).toBeCloseTo(0.075);
    expect(costOf({ ...calm, calls: 200 })).toBeCloseTo(0.6);
    expect(costOf({ ...calm, calls: 900 })).toBeCloseTo(0.6);
    expect(costOf({ ...calm, tired: 1 })).toBeCloseTo(0.2);
    expect(costOf({ ...calm, stress: 0.5 })).toBe(0);
    expect(costOf({ ...calm, stress: 1 })).toBeCloseTo(0.2);
  });

  it("the three verdicts at the right levels", () => {
    const at = (more: Partial<Parameters<typeof verdictOf>[0]>) => verdictOf({ control: 0, trouble: 0, leave: 0, spent: false, troubledMs: 0, ...more }).verdict;
    expect(at({ control: 0.5, trouble: 0.8 })).toBe("try harder");
    expect(at({ control: 0.49, trouble: 0.8 })).toBe("carry on");
    expect(at({})).toBe("carry on");
    // Trouble that more effort is not worth, once it has lasted.
    expect(at({ control: 0.05, trouble: 0.5, troubledMs: LEAVE_IT.afterMs })).toBe("leave it");
    expect(at({ control: 0.05, trouble: 0.5, troubledMs: LEAVE_IT.afterMs - 1 })).toBe("carry on");
    expect(at({ control: 0.2, trouble: 0.5, troubledMs: 60_000 })).toBe("carry on");
    // Paying much worse than the background is a reason by itself; worth trying harder comes first.
    expect(at({ leave: 0.8 })).toBe("leave it");
    expect(at({ leave: 0.9, control: 0.6 })).toBe("try harder");
  });

  it("a spent budget gives carry on, and says why", () => {
    expect(verdictOf({ control: 0.9, trouble: 1, leave: 1, spent: true, troubledMs: 60_000 })).toEqual({ verdict: "carry on", why: "the call budget is spent" });
  });
});

describe("stay or leave", () => {
  const nothing = { reward: 0, steps: 0, ground: 0 };
  /** Ten minutes in which things went well: a reward a minute. */
  function goodTimes(leave = createLeave()) {
    for (let at = 0; at <= 600_000; at += 500) leave.tick(at % 20_000 === 0 ? "work" : "work", { ...nothing, reward: at % 60_000 === 0 ? 1 : 0 }, at);
    return leave;
  }

  it("is up when the running activity pays well under the background, for a while", () => {
    const leave = goodTimes();
    let now = 600_000;
    const tick = (ms: number) => leave.tick("dig", nothing, (now += ms));
    // Not judged in its first seconds.
    expect(tick(500).leave).toBe(0);
    expect(tick(JUDGED_AFTER_MS - 1000).leave).toBe(0);
    const early = tick(1000);
    expect(early).toMatchObject({ leave: 0, current: 0 });
    expect(early.background).toBeGreaterThan(0.5);
    // Worse for a while: it grows to full over a minute.
    expect(tick(FOR_A_WHILE_MS / 2).leave).toBeCloseTo(0.5, 1);
    expect(tick(FOR_A_WHILE_MS).leave).toBe(1);
  });

  it("is 0 when the activity pays as well as the background or better, and for rest", () => {
    const leave = goodTimes();
    let now = 600_000;
    let worst = 0;
    for (let i = 0; i < 600; i++) worst = Math.max(worst, leave.tick("mine", { ...nothing, reward: i % 60 === 0 ? 1 : 0 }, (now += 500)).leave);
    expect(worst).toBe(0);
    for (let i = 0; i < 600; i++) worst = Math.max(worst, leave.tick(null, nothing, (now += 500)).leave);
    expect(worst).toBe(0);
  });

  it("a new activity starts afresh; steps finished and ground covered are progress too; with no background nothing is paying worse", () => {
    const leave = goodTimes();
    let now = 600_000;
    for (let i = 0; i < 400; i++) leave.tick("dig", nothing, (now += 500));
    expect(leave.tick("dig", nothing, (now += 500)).leave).toBe(1);
    expect(leave.tick("walk", nothing, (now += 500)).leave).toBe(0);
    expect(payOf({ reward: 0, steps: 1, ground: 10 })).toBeCloseTo(0.7);
    expect(payOf({ reward: -3, steps: 0, ground: 0 })).toBe(0);
    const fresh = createLeave();
    let quiet = 0;
    for (let at = 0; at <= 300_000; at += 500) quiet = Math.max(quiet, fresh.tick("idle about", nothing, at).leave);
    expect(quiet).toBe(0);
  });
});

describe("how changeable things are", () => {
  it("is up after a run of surprises, and down again after a steady spell", () => {
    const changeable = createChangeable();
    let now = 0;
    const quiet = (ms: number) => {
      let last = { changeable: 0, recent: 0, usual: 0 };
      for (let spent = 0; spent < ms; spent += 500) last = changeable.tick({ outcome: 0 }, (now += 500));
      return last;
    };
    // An hour in which a surprise comes every five minutes: that is the usual.
    for (let i = 0; i < 12; i++) {
      expect(changeable.tick({ outcome: 0.8 }, (now += 500)).changeable).toBeLessThan(0.05);
      quiet(300_000);
    }
    // Then six in a minute.
    let burst = 0;
    for (let i = 0; i < 6; i++) {
      burst = changeable.tick({ outcome: 0.8 }, (now += 500)).changeable;
      quiet(9500);
    }
    expect(burst).toBeGreaterThan(0.5);
    expect(quiet(15 * 60_000).changeable).toBe(0);
  });

  it("a young bot's first surprises are not more than usual: there is no usual yet", () => {
    const changeable = createChangeable();
    let worst = 0;
    for (let at = 0; at <= 120_000; at += 500) worst = Math.max(worst, changeable.tick({ outcome: at % 20_000 === 0 ? 0.9 : 0 }, at).changeable);
    expect(worst).toBe(0);
  });

  it("counts a source when it rises, not for as long as it stays up; a steady trickle is the usual", () => {
    const held = createChangeable();
    let now = 0;
    held.tick({ scene: 0 }, now);
    for (let i = 0; i < 200; i++) held.tick({ scene: 0.9 }, (now += 500));
    expect(held.tick({ scene: 0.9 }, (now += 500)).recent).toBeLessThan(0.5);
    const steady = createChangeable();
    let level = 0;
    for (let at = 0; at <= 4 * 3_600_000; at += 500) level = steady.tick({ outcome: at % 120_000 === 0 ? 0.6 : 0 }, at).changeable;
    expect(level).toBe(0);
  });
});

describe("the cingulate region", () => {
  const signal = new AbortController().signal;
  function setUp(more: Partial<CingulateOptions> = {}) {
    const store = createWorkspace();
    const now = { signs: {} as Record<string, number>, stake: 1, close: 1, reflex: false, calls: 0, activity: null as string | null };
    const names = ["mismatch", "unexpected", "pain"];
    const region = createCingulateRegion({
      settings: DEFAULT_CINGULATE,
      sources: names.map((name) => ({ name, read: () => now.signs[name] ?? 0 })),
      stake: () => ({ need: now.stake, goal: 0, skill: 0 }),
      chance: () => ({ close: now.close, unknown: 0, unfamiliar: 0, reflex: now.reflex }),
      calls: () => now.calls,
      activity: () => now.activity,
      progress: () => ({ reward: 0, steps: 0, ground: 0 }),
      surprises: () => ({ movement: now.signs.mismatch ?? 0 }),
      ...more,
    });
    let ms = 0;
    const tick = (afterMs = 500) => {
      ms += afterMs;
      store.update({ schemaVersion: 1, tick: 0, timestamp: ms, data: {} }, null);
      const out = region.run(store.viewFor("cingulate"), signal) as { proposals: unknown[]; trace?: Record<string, any> };
      return { ...out, trouble: store.trouble(), signals: store.signals() };
    };
    return { now, tick };
  }

  it("writes one reading of trouble as data, proposes nothing and shares no signal but `inward`", () => {
    const c = setUp();
    expect(c.tick().trouble).toEqual({ level: 0, events: [], control: 0, verdict: "carry on", leave: 0, changeable: 0 });
    c.now.signs = { mismatch: 0.9, unexpected: 0.6, pain: 0.4 };
    const { trouble, proposals, signals, trace } = c.tick();
    expect(proposals).toEqual([]);
    expect(Object.keys(signals)).toEqual(["inward"]);
    expect(trouble).toMatchObject({ level: 0.9, events: [{ kinds: ["mismatch", "unexpected", "pain"], strength: 0.9, age: 0 }], control: 0.9, verdict: "try harder" });
    expect(trace).toMatchObject({ trouble: { level: 0.9 }, stake: 1, chance: 1, cost: 0, control: 0.9, verdict: "try harder", would: { wakePlanner: true, hurryDeciders: true, giveUp: false } });
  });

  it("would wake the planner once for one event, and again no sooner than five seconds on", () => {
    const c = setUp();
    c.now.signs = { mismatch: 0.9 };
    expect(c.tick().trace!.would.wakePlanner).toBe(true);
    for (let ms = 500; ms < WAKE_GAP_MS; ms += 500) expect(c.tick().trace!.would.wakePlanner).toBe(false);
    expect(c.tick().trace!.would.wakePlanner).toBe(true);
  });

  it("with nothing at stake, or a reflex already dealing with it, the same trouble is not worth more effort", () => {
    const c = setUp();
    c.now.signs = { mismatch: 0.9 };
    c.now.stake = 0;
    expect(c.tick().trouble).toMatchObject({ level: 0.9, control: 0, verdict: "carry on" });
    c.now.stake = 1;
    c.now.reflex = true;
    expect(c.tick().trouble!.control).toBeCloseTo(0.18);
  });

  it("with the call budget spent the verdict is carry on, and the trace says why", () => {
    const c = setUp();
    c.now.signs = { mismatch: 1 };
    c.now.calls = 200;
    const { trouble, trace } = c.tick();
    expect(trouble).toMatchObject({ level: 1, verdict: "carry on" });
    expect(trace).toMatchObject({ why: "the call budget is spent", calls: 200, would: { wakePlanner: false } });
  });

  it("each part has its own strength, and with gathering off nothing is written", () => {
    const half = setUp({ settings: { ...DEFAULT_CINGULATE, gather: 0.5, control: 0.5 } });
    half.now.signs = { mismatch: 1 };
    expect(half.tick().trouble).toMatchObject({ level: 0.5, control: 0.25 });
    const off = setUp({ settings: NO_CINGULATE });
    off.now.signs = { mismatch: 1 };
    const { trouble, trace } = off.tick();
    expect([trouble, trace]).toEqual([null, undefined]);
  });

  it("the same readings give the same reading, and it takes far under a millisecond a tick", () => {
    const run = () => {
      const c = setUp();
      const out: unknown[] = [];
      for (let i = 0; i < 40; i++) {
        c.now.signs = { mismatch: i % 7 === 0 ? 0.8 : 0, pain: i % 11 === 0 ? 0.5 : 0 };
        out.push(c.tick().trouble);
      }
      return out;
    };
    expect(run()).toEqual(run());
    const c = setUp();
    c.now.activity = "dig";
    const started = performance.now();
    for (let i = 0; i < 2000; i++) {
      c.now.signs = { mismatch: (i % 9) / 9, unexpected: (i % 5) / 5, pain: (i % 3) / 3 };
      c.tick(1);
    }
    expect((performance.now() - started) / 2000).toBeLessThan(0.5);
  });

  it("a bad setting is named", () => {
    expect(cingulateProblem(DEFAULT_CINGULATE)).toBeNull();
    expect(cingulateProblem({ ...DEFAULT_CINGULATE, leave: 2 })).toBe("cingulate.leave must be a number from 0 to 1, got 2");
  });
});

describe("the cingulate's readers", () => {
  it("a learning rate is multiplied by (0.5 + changeable), as far as the reader's strength goes", () => {
    expect(rateScale(0, 1)).toBe(0.5);
    expect(rateScale(0.5, 1)).toBe(1);
    expect(rateScale(1, 1)).toBe(1.5);
    expect(rateScale(1, 0.5)).toBe(1.25);
    // At strength 0 the rate is left as it is, whatever is changeable.
    for (const changeable of [0, 0.3, 1]) expect(rateScale(changeable, 0)).toBe(1);
    expect(rateScale(7, 1)).toBe(1.5);
  });

  it("each reader has a strength of its own, in shadow all are 0, and a bad one is named", () => {
    expect(Object.keys(DEFAULT_CINGULATE.readers)).toEqual(["planner", "gate", "view", "focus", "alarm", "patience", "habit", "learning"]);
    expect(Object.values(SHADOW_CINGULATE.readers).every((strength) => strength === 0)).toBe(true);
    expect(SHADOW_CINGULATE.gather).toBe(1);
    expect(cingulateProblem({ ...DEFAULT_CINGULATE, readers: { ...DEFAULT_CINGULATE.readers, focus: -1 } })).toBe("cingulate.readers.focus must be a number from 0 to 1, got -1");
  });
});
