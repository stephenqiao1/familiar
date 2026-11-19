import { describe, expect, it } from "vitest";
import type { SkillEvent } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { DEFAULT_AROUSAL, type ArousalSettings } from "./arousal-settings.js";
import { createReticularRegion, type Moment } from "./reticular-region.js";

const signal = new AbortController().signal;
const day: Moment = { night: false, nightProgress: 0, safe: true, idle: true, still: true, asleep: false, demanding: false, risky: false, health: 1 };
const night: Moment = { ...day, night: true, nightProgress: 0.1 };
const inBed = (nightProgress: number): Moment => ({ ...night, nightProgress, asleep: true });

/** A reticular region on a workspace; other regions' signals are set by hand. */
function bot(settings: Partial<ArousalSettings> = {}, bed: { canSleep?: () => string | null } | null = {}) {
  const store = createWorkspace();
  const set = (name: string, value: number) => store.viewFor("other").setSignal(name, value);
  const region = createReticularRegion({
    settings: { ...DEFAULT_AROUSAL, ...settings },
    alarmOf: (ws) => ws.signals.alarm?.value ?? 0,
    hardReflex: (ws) => (ws.signals.hard_reflex?.value ?? 0) > 0,
    moment: (ws) => ws.state.data as unknown as Moment,
    ...(bed ? { bed: { skill: "sleep", problem: () => bed.canSleep?.() ?? null } } : {}),
  });
  let ms = 0;
  const tick = async (moment: Moment = day, running: string | null = null, afterMs = 500) => {
    ms += afterMs;
    store.update({ schemaVersion: 1, tick: 0, timestamp: ms, data: { ...moment } }, running ? { skill: running, target: undefined, startedAt: 0 } : null);
    return region.run(store.viewFor("reticular"), signal);
  };
  /** Ticks every half second for a while; returns the last. */
  const run = async (seconds: number, moment: Moment = day, running: string | null = null) => {
    let out = await tick(moment, running);
    for (let t = 0.5; t < seconds; t += 0.5) out = await tick(moment, running);
    return out;
  };
  const value = (name: string) => store.signals()[name]?.value;
  const event = (e: Partial<SkillEvent>) => store.addEvent({ skill: "sleep", type: "failed", timestamp: ms, ...e } as SkillEvent);
  return { store, set, tick, run, value, event, now: () => ms };
}

describe("createReticularRegion", () => {
  it("runs every tick on the fastest layer, and is silent before the first state", async () => {
    const region = createReticularRegion({ settings: DEFAULT_AROUSAL, alarmOf: () => 0, moment: () => null });
    expect(region).toMatchObject({ name: "reticular", layer: 0, everyMs: 0 });
    expect(await region.run(createWorkspace().viewFor("reticular"), signal)).toEqual({ proposals: [] });
  });

  describe("the arousal level", () => {
    it("rests at 0.5 awake by day, with the gate fully open", async () => {
      const { run, value } = bot();
      const out = await run(5);
      expect(value("arousal")).toBeCloseTo(0.5);
      expect([value("upper_rate"), value("upper_paused"), value("quiet"), value("frazzled")]).toEqual([1, 0, 0, 0]);
      expect(out.trace).toMatchObject({ band: "awake", wake: { value: 0, by: "nothing" }, target: 0.5 });
    });
    it("alarm raises it within a second; calm lets it fall over about 20", async () => {
      const { set, run, value } = bot();
      await run(2);
      set("alarm", 0.8);
      const up = await run(1);
      expect(value("arousal")).toBeGreaterThan(0.85);
      expect(up.trace).toMatchObject({ band: "alert", wake: { value: 0.8, by: "alarm" } });
      set("alarm", 0);
      await run(3);
      expect(value("arousal")).toBeGreaterThan(0.7);
      await run(20);
      expect(value("arousal")).toBeLessThan(0.53);
    });
    it("tired at night with nothing to do, it sinks toward drowsy; by day it sinks less", async () => {
      const at = async (moment: Moment) => {
        const { set, run, value } = bot({}, null);
        set("tired", 0.4);
        await run(60, moment);
        return value("arousal")!;
      };
      const [byNight, byDay] = [await at(night), await at(day)];
      expect(byNight).toBeLessThan(0.25);
      expect(byDay).toBeGreaterThan(0.4);
      expect(byDay).toBeLessThan(0.5);
    });
    it("the band does not flicker: at most one change in 3 seconds, except upward for danger", async () => {
      const { set, tick, run } = bot();
      await run(5);
      set("alarm", 0.9);
      expect((await tick()).trace?.band).toBe("alert");
      // Danger has already moved it once; a second jump upward still goes through.
      expect((await run(1.5)).trace?.band).toBe("over-aroused");
      set("alarm", 0);
      // Falling back takes time, and the label waits its 3 seconds.
      expect((await run(1.5)).trace?.band).toBe("over-aroused");
      expect((await run(3)).trace?.band).toBe("alert");
    });
  });

  describe("sleepy and bedtime", () => {
    const tired = (settings: Partial<ArousalSettings> = {}, bed: Parameters<typeof bot>[1] = {}) => {
      const b = bot(settings, bed);
      b.set("tired", 0.33);
      return b;
    };
    it("shares sleepy: tiredness, raised at night and lowered by day; none while a threat is coming", async () => {
      const { set, tick, value } = tired();
      await tick(night);
      expect(value("sleepy")).toBeCloseTo(0.68);
      await tick(day);
      expect(value("sleepy")).toBeCloseTo(0.13);
      set("threat", 0.8);
      await tick(night);
      expect(value("sleepy")).toBe(0);
    });
    it("proposes bed when sleepy and safe, harder the sleepier it is", async () => {
      const { set, tick } = tired();
      const out = await tick(night);
      expect(out.proposals).toMatchObject([{ action: { skill: "sleep" } }]);
      expect(out.proposals[0]!.urgency).toBeCloseTo(0.2 + 0.4 * (0.18 / 0.5));
      expect(out.trace?.bedtime).toMatchObject({ proposed: 0.34 });
      set("tired", 1);
      expect((await tick(night)).proposals[0]!.urgency).toBeCloseTo(0.6);
    });
    it("stays up when not tired, by day, or with bedtime off", async () => {
      const fresh = bot();
      expect((await fresh.tick(night)).proposals).toEqual([]);
      expect((await tired().tick(day)).proposals).toEqual([]);
      expect((await tired({ bedtime: 0 }).tick(night)).proposals).toEqual([]);
    });
    it("never proposes bed with a threat seen or a risky skill under way, and says why", async () => {
      const seen = tired();
      seen.set("threat", 0.5);
      expect((await seen.tick(night)).proposals).toEqual([]);
      const risky = tired();
      expect((await risky.tick({ ...night, risky: true, idle: false }, "attack")).proposals).toEqual([]);
      // Already on its way when the threat shows: it holds off, and says so.
      const b = tired();
      await b.tick(night);
      b.set("threat", 0.5);
      const out = await b.tick(night);
      expect(out.proposals).toEqual([]);
      expect(out.trace?.bedtime).toMatchObject({ delayed: "a threat is in view" });
    });
    it("flip-flop: once heading to bed it holds until sleepy falls below 0.3; once up, not again until above 0.5", async () => {
      const { set, tick } = bot();
      set("tired", 0.2);
      expect((await tick(night)).proposals).toHaveLength(1); // sleepy 0.55
      set("tired", 0.05);
      expect((await tick(night)).proposals).toHaveLength(1); // sleepy 0.40: between the two, still heading
      set("tired", 0);
      expect((await tick(night)).proposals).toHaveLength(1); // 0.35
      set("tired", 0.1);
      expect((await tick(day)).proposals).toEqual([]); // by day sleepy is 0: given up
      set("tired", 0.1);
      expect((await tick(night)).proposals).toEqual([]); // 0.45: not back to bed below 0.5
      set("tired", 0.2);
      expect((await tick(night)).proposals).toHaveLength(1);
    });
    it("a wake drive above 0.5 ends a trip to bed", async () => {
      const { set, tick } = tired();
      await tick(night);
      set("alarm", 0.6);
      expect((await tick(night)).proposals).toEqual([]);
      set("alarm", 0);
      expect((await tick(night)).proposals).toHaveLength(1);
    });
    it("after sleep is refused it stops proposing for 30 seconds", async () => {
      const b = tired();
      await b.tick(night);
      b.event({ reason: "it is not night" });
      const out = await b.tick(night);
      expect(out.proposals).toEqual([]);
      expect(out.trace?.bedtime).toMatchObject({ delayed: expect.stringContaining("sleep was refused") });
      expect((await b.run(28, night)).proposals).toEqual([]);
      expect((await b.run(3, night)).proposals).toHaveLength(1);
      // An interruption is not a refusal.
      b.event({ type: "interrupted" });
      expect((await b.tick(night)).proposals).toHaveLength(1);
    });
    it("with no bed in reach it shares sleepy, proposes nothing and says so", async () => {
      const { tick, value } = tired({}, { canSleep: () => "no bed in reach" });
      const out = await tick(night);
      expect(out.proposals).toEqual([]);
      expect(value("sleepy")).toBeCloseTo(0.68);
      expect(out.trace?.bedtime).toEqual({ sleepy: 0.68, delayed: "no bed in reach" });
      const none = bot({}, null);
      none.set("tired", 0.33);
      expect((await none.tick(night)).trace?.bedtime).toMatchObject({ delayed: "no way to sleep is known" });
    });
  });

  describe("asleep", () => {
    it("shares depth (deep early, light toward morning), sinks into the asleep band and closes the gate", async () => {
      const { tick, run, value } = bot();
      const early = await tick(inBed(0.1), "sleep");
      expect(value("depth")).toBe(0.9);
      expect([value("upper_rate"), value("upper_paused")]).toEqual([0, 1]);
      await run(30, inBed(0.1), "sleep");
      expect(value("arousal")).toBeLessThan(0.15);
      await tick(inBed(1), "sleep");
      expect(value("depth")).toBeCloseTo(0.4);
      await tick(day);
      expect(value("depth")).toBe(0);
      expect(early.trace).toMatchObject({ asleep: true, depth: 0.9 });
    });
    it("speaks for staying asleep at 0.3 + 0.4 × depth: a light sleeper is easier to rouse", async () => {
      const { tick } = bot();
      expect((await tick(inBed(0.1), "sleep")).proposals).toEqual([{ action: { skill: "sleep" }, urgency: 0.66, reason: "asleep (depth 0.9) and undisturbed" }]);
      expect((await tick(inBed(1), "sleep")).proposals[0]!.urgency).toBeCloseTo(0.46);
    });
    it("a weak event wakes a light sleeper and not a deep one", async () => {
      for (const [progress, wakes] of [[0.1, false], [1, true]] as const) {
        const { set, tick, value } = bot();
        await tick(inBed(progress), "sleep");
        set("alarm", 0.3);
        const out = await tick(inBed(progress), "sleep");
        expect(value("upper_paused")).toBe(wakes ? 0 : 1);
        expect(out.trace?.waking === undefined).toBe(!wakes);
      }
    });
    it("an urge above the threshold wakes it (starving, before it hurts); a heavier sleeper needs more", async () => {
      const usual = bot();
      await usual.tick(inBed(0.1), "sleep");
      usual.set("urge", 0.4);
      expect((await usual.tick(inBed(0.1), "sleep")).trace?.waking).toBeUndefined();
      usual.set("urge", 0.9);
      const out = await usual.tick(inBed(0.1), "sleep");
      expect(out.trace?.waking).toMatchObject({ by: "urge", strength: 0.9, depth: 0.9, sleptMs: 1000 });
      expect(out.proposals).toEqual([]);
      const heavy = bot({ wakeThreshold: 1 });
      await heavy.tick(inBed(0.1), "sleep");
      heavy.set("urge", 0.9);
      expect((await heavy.tick(inBed(0.1), "sleep")).trace?.waking).toBeUndefined();
    });
    it("a hurt, a full startle or a hard reflex wakes it on the same tick, however deep and however heavy a sleeper", async () => {
      const cases: [string, (b: ReturnType<typeof bot>) => Promise<{ trace?: Record<string, unknown> }>][] = [
        ["a hurt", (b) => b.tick({ ...inBed(0.1), health: 0.9 }, "sleep")],
        ["a startle", (b) => (b.set("startle", 0.7), b.tick(inBed(0.1), "sleep"))],
        ["a hard reflex", (b) => (b.set("hard_reflex", 1), b.tick(inBed(0.1), "sleep"))],
      ];
      for (const [by, wake] of cases) {
        const b = bot({ wakeThreshold: 1 });
        await b.tick(inBed(0.1), "sleep");
        const out = await wake(b);
        expect(out.trace?.waking, by).toMatchObject({ by, depth: 0.9 });
        expect([b.value("upper_rate"), b.value("upper_paused")], by).toEqual([1, 0]);
      }
    });
    it("a hurt that has already thrown it out of bed is still logged as the hurt, and leaves it wide awake", async () => {
      const { tick, run, value } = bot();
      await run(40, inBed(0.5), "sleep");
      const out = await tick({ ...night, health: 0.9 });
      expect(out.trace).toMatchObject({ waking: { by: "a hurt", calm: false } });
      expect(out.trace?.groggy).toBeUndefined();
      expect(value("arousal")).toBeGreaterThanOrEqual(0.5);
    });
    it("groggy after a calm waking: arousal starts at 0.25 and takes about 10 seconds to climb", async () => {
      const { tick, run, value } = bot();
      await run(40, inBed(0.9), "sleep");
      const up = await tick(day);
      expect(up.trace).toMatchObject({ waking: { by: "getting up", calm: true }, groggy: true });
      expect(value("arousal")).toBe(0.25);
      await run(3);
      expect(value("arousal")).toBeLessThan(0.42);
      await run(9);
      expect(value("arousal")).toBeGreaterThan(0.46);
    });
    it("not groggy after a danger waking: arousal jumps straight up; nor with inertia at 0", async () => {
      const { tick, run, value } = bot();
      await run(40, inBed(0.5), "sleep");
      const out = await tick({ ...inBed(0.5), health: 0.8 }, "sleep");
      expect(out.trace).toMatchObject({ waking: { by: "a hurt", calm: false } });
      expect(out.trace?.groggy).toBeUndefined();
      expect(value("arousal")).toBeGreaterThanOrEqual(0.5);
      const none = bot({ inertia: 0 });
      await none.run(40, inBed(0.9), "sleep");
      await none.tick(day);
      expect(none.value("arousal")).toBe(0.5);
    });
  });

  describe("the graded gate", () => {
    it("is about 0.3 drowsy and 1 awake; anything urgent sets it to 1 at once", async () => {
      const { set, tick, run, value } = bot({}, null);
      set("tired", 0.33);
      await run(60, night);
      expect(value("arousal")).toBeLessThan(0.35);
      expect(value("upper_rate")).toBeGreaterThan(0.05);
      expect(value("upper_rate")).toBeLessThan(0.35);
      expect(value("upper_paused")).toBe(0);
      set("threat", 0.8);
      await tick(night);
      expect(value("upper_rate")).toBe(1);
    });
    it("with the gate off the rate is always 1 and nothing speaks for staying asleep", async () => {
      const { tick, value } = bot({ gate: 0 });
      const out = await tick(inBed(0.1), "sleep");
      expect([value("upper_rate"), value("upper_paused")]).toEqual([1, 0]);
      expect(out.proposals).toEqual([]);
    });
  });

  describe("quiet and frazzled", () => {
    it("quiet appears after 60 drowsy, safe, still seconds and ends on movement", async () => {
      const { set, tick, run, value } = bot({}, null);
      set("tired", 0.9);
      await run(40, day);
      expect(value("arousal")).toBeLessThan(0.35);
      expect(value("quiet")).toBe(0);
      const out = await run(60, day);
      expect(value("quiet")).toBe(1);
      expect(out.trace).toMatchObject({ quiet: true, band: "drowsy" });
      await tick({ ...day, still: false });
      expect(value("quiet")).toBe(0);
      // And it takes a full minute again.
      await run(30, day);
      expect(value("quiet")).toBe(0);
    });
    it("no quiet with a threat in view, or with quietRest off", async () => {
      const seen = bot({}, null);
      seen.set("tired", 0.9);
      seen.set("threat", 0.5);
      await seen.run(120, day);
      expect(seen.value("quiet")).toBe(0);
      const off = bot({ quietRest: 0 }, null);
      off.set("tired", 0.9);
      await off.run(120, day);
      expect(off.value("quiet")).toBe(0);
    });
    it("frazzled appears above 0.9, and not with it switched off", async () => {
      const { set, run, value } = bot();
      set("threat", 1);
      const out = await run(3);
      expect(value("arousal")).toBeGreaterThan(0.9);
      expect(value("frazzled")).toBe(1);
      expect(out.trace).toMatchObject({ band: "over-aroused", frazzled: true });
      const off = bot({ frazzled: 0 });
      off.set("threat", 1);
      await off.run(3);
      expect(off.value("frazzled")).toBe(0);
    });
  });
});
