import { describe, expect, it } from "vitest";
import type { State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { createBrainstemRegion, type BrainstemOptions } from "./brainstem-region.js";
import { DEFAULT_BRAINSTEM, type BrainstemSettings } from "./settings.js";

const signal = new AbortController().signal;

/** A made-up world: just what the brainstem's readers need. */
interface World {
  health?: number;
  air?: number;
  hunger?: number;
  asleep?: boolean;
  night?: boolean;
  /** A sudden event this tick: true (strong), or its intensity. */
  bang?: boolean | number;
  /** Extra fields for that event (foreseen, selfCaused, place, kind, cause). */
  hit?: Record<string, unknown>;
  dark?: number;
  things?: { id: string; kind: string }[];
}
const world = (state: State) => state.data as World;

function bot(settings: Partial<BrainstemSettings> = {}, over: Partial<BrainstemOptions> = {}) {
  const store = createWorkspace();
  const region = createBrainstemRegion({
    settings: { ...DEFAULT_BRAINSTEM, ...settings },
    alarmOf: (ws) => ws.signals.alarm?.value ?? 0,
    hardReflex: (ws) => (ws.signals.hard_reflex?.value ?? 0) > 0,
    startle: [{ name: "bang", check: ({ after }) => (world(after).bang ? { source: world(after).things?.[0] ?? null, intensity: typeof world(after).bang === "number" ? (world(after).bang as number) : 0.9, kind: "bang", ...world(after).hit } : null) }],
    thingsOf: (state) => world(state).things ?? [],
    responseProblem: (skill) => (skill === "flee" ? null : "unknown skill"),
    acceptsTarget: () => true,
    holdable: ["flee", "defend"],
    body: (state) => ({ health: world(state).health ?? 1 }),
    skills: { brace: "brace", flinch: "flinch" },
    surroundings: (state) => ({ dark: world(state).dark ?? 0, badPlace: 0 }),
    ...over,
  });
  let ms = 0;
  const tick = async (w: World = {}, current: string | null = null, afterMs = 500) => {
    ms += afterMs;
    store.update({ schemaVersion: 1, tick: 0, timestamp: ms, data: { ...w } }, current ? { skill: current, target: undefined, startedAt: 0 } : null);
    return region.run(store.viewFor("brainstem"), signal);
  };
  const value = (name: string) => store.signals()[name]?.value;
  return { store, tick, value };
}

describe("createBrainstemRegion", () => {
  it("runs every tick on the fastest layer", () => {
    expect(createBrainstemRegion({} as BrainstemOptions & { settings: BrainstemSettings })).toMatchObject({ name: "brainstem", layer: 0, everyMs: 0 });
  });

  describe("startle", () => {
    const zombie = { id: "entity:1", kind: "zombie" };

    it("a strong event: shares startle as its size for one tick and proposes bracing toward the source, at full urgency", async () => {
      const { tick, value } = bot();
      await tick();
      const out = await tick({ bang: 0.9, things: [zombie] });
      expect(value("startle")).toBeCloseTo(0.9);
      expect(out.proposals).toContainEqual({ action: { skill: "brace", target: "entity:1" }, urgency: 1, reason: "startled: bang (0.9)" });
      expect(out.trace).toMatchObject({ startle: { by: "bang", intensity: 0.9, potentiation: 1, warning: 0, habituated: 0, magnitude: 0.9, size: "full" } });
      const next = await tick({ things: [zombie] });
      expect(value("startle")).toBe(0);
      expect(next.proposals).toEqual([]);
    });

    it("a milder one is a flinch, proposed below urgency 1; a weak one is nothing at all", async () => {
      const { tick, value } = bot();
      await tick();
      const out = await tick({ bang: 0.4, things: [zombie] });
      expect(out.proposals).toEqual([{ action: { skill: "flinch", target: "entity:1" }, urgency: 0.9, reason: "flinched: bang (0.4)" }]);
      expect(value("startle")).toBeCloseTo(0.4);
      const weak = await bot().tick({ bang: 0.4 });
      expect(weak.proposals).toEqual([]); // the first tick has nothing to compare with
      const quiet = bot();
      await quiet.tick();
      const none = await quiet.tick({ bang: 0.2 });
      expect(none.proposals).toEqual([]);
      expect(quiet.value("startle")).toBe(0);
      expect(none.trace).toMatchObject({ startleQuiet: { by: "bang", magnitude: 0.2, why: "too small" } });
    });

    it("a flinch does not cut across a hard reflex's skill", async () => {
      const { store, tick, value } = bot();
      await tick();
      store.viewFor("reflex").setSignal("hard_reflex", 1);
      const out = await tick({ bang: 0.4 }, "escape_hazard");
      expect(out.proposals).toEqual([]);
      expect(value("startle")).toBe(0);
      expect(out.trace).toMatchObject({ startleQuiet: { why: "a hard reflex is acting" } });
    });

    it("is bigger when the body is on edge: alarm, soreness and the dark", async () => {
      const edgy = bot({}, { body: () => ({ health: 1, sore: 1 }) });
      edgy.store.viewFor("noradrenaline").setSignal("alarm", 1);
      await edgy.tick({ dark: 1 });
      const out = await edgy.tick({ bang: 0.5, dark: 1 });
      expect(out.trace).toMatchObject({ startle: { potentiation: 1.6, magnitude: 0.8, size: "full" } });
    });

    it("is smaller, or silent, when it was seen coming, got used to, or self-caused", async () => {
      const seen = bot();
      await seen.tick();
      expect((await seen.tick({ bang: 0.9, hit: { foreseen: 1 } })).trace).toMatchObject({ startleQuiet: { warning: 0.8, why: "too small" } });
      const own = bot();
      await own.tick();
      expect((await own.tick({ bang: 1, hit: { selfCaused: true } })).trace).toMatchObject({ startleQuiet: { selfCaused: true, magnitude: 0, why: "self-caused" } });
      const used = bot();
      await used.tick();
      const sizes: number[] = [];
      for (let i = 0; i < 4; i++) {
        await used.tick({ bang: 0.9, hit: { place: "0,0" } }, null, 3000);
        sizes.push(used.value("startle")!);
        await used.tick({}, null, 1000);
      }
      expect(sizes[0]).toBeCloseTo(0.9);
      expect(sizes[1]).toBeLessThan(sizes[0]!);
      expect(sizes[3]).toBe(0);
    });

    it("fires again a second later, not sooner", async () => {
      const { tick, value } = bot();
      await tick();
      await tick({ bang: 0.9, hit: { kind: "a" } });
      expect(value("startle")).toBeCloseTo(0.9);
      await tick({});
      const soon = await tick({ bang: 0.9, hit: { kind: "b" } }, null, 300);
      expect(value("startle")).toBe(0);
      expect(soon.trace).toMatchObject({ startleQuiet: { why: "refractory" } });
      await tick({}, null, 100);
      await tick({ bang: 0.9, hit: { kind: "c" } }, null, 700);
      expect(value("startle")).toBeCloseTo(0.9);
    });

    it("damage on the same tick caps the damping: it still startles", async () => {
      const { tick, value } = bot();
      await tick();
      await tick({ bang: 0.9, health: 0.7, hit: { foreseen: 1 } });
      expect(value("startle")).toBeCloseTo(0.45);
    });

    it("says which alarm trigger shares its cause, for that tick only", async () => {
      const { tick, value } = bot();
      await tick();
      await tick({ bang: 0.9, hit: { cause: "damage" } });
      expect(value("startle_from_damage")).toBeCloseTo(0.9);
      await tick();
      expect(value("startle_from_damage")).toBe(0);
    });

    it("the strength setting scales it: 0 never startles, 1.5 startles harder", async () => {
      const off = bot({ startle: 0 });
      await off.tick();
      expect((await off.tick({ bang: 1 })).proposals).toEqual([]);
      expect(off.value("startle")).toBeUndefined();
      const jumpy = bot({ startle: 1.5 });
      await jumpy.tick();
      await jumpy.tick({ bang: 0.5 });
      expect(jumpy.value("startle")).toBeCloseTo(0.75);
    });
  });

  describe("releasing a prepared action", () => {
    const goal = (ifThen: { when: string; skill: string; onStartle?: boolean }[]) => ({ text: "g", steps: [], reason: "", ifThen });

    it("a full startle from an unrelated source fires the response marked onStartle, once, in place of the brace", async () => {
      const { store, tick } = bot();
      store.viewFor("prefrontal").setGoal(goal([{ when: "creeper", skill: "flee", onStartle: true }]));
      await tick();
      const out = await tick({ bang: 0.9 });
      expect(out.proposals).toEqual([{ action: { skill: "flee" }, urgency: 1, reason: "startled (bang): releasing the prepared flee" }]);
      expect(out.trace).toMatchObject({ startle: { size: "full", released: "flee" }, loadedResponse: { skill: "flee", releasedByStartle: true } });
      // Not again straight away: the usual limit on loaded responses holds.
      await tick({}, null, 600);
      const again = await tick({ bang: 0.9, hit: { kind: "other" } }, null, 600);
      expect(again.proposals.map((p) => ("skill" in p.action ? p.action.skill : ""))).toEqual(["brace"]);
    });

    it("a prepared response that cannot be started right now is not released: the body braces instead", async () => {
      const { store, tick } = bot({}, { canStart: () => false });
      store.viewFor("prefrontal").setGoal(goal([{ when: "creeper", skill: "flee", onStartle: true }]));
      await tick();
      expect((await tick({ bang: 0.9 })).proposals.map((p) => ("skill" in p.action ? p.action.skill : ""))).toEqual(["brace"]);
    });

    it("not on a flinch, not without the mark, and not with the release switched off", async () => {
      const flinch = bot();
      flinch.store.viewFor("prefrontal").setGoal(goal([{ when: "creeper", skill: "flee", onStartle: true }]));
      await flinch.tick();
      expect((await flinch.tick({ bang: 0.4 })).proposals.map((p) => ("skill" in p.action ? p.action.skill : ""))).toEqual(["flinch"]);
      const unmarked = bot();
      unmarked.store.viewFor("prefrontal").setGoal(goal([{ when: "creeper", skill: "flee" }]));
      await unmarked.tick();
      expect((await unmarked.tick({ bang: 0.9 })).proposals.map((p) => ("skill" in p.action ? p.action.skill : ""))).toEqual(["brace"]);
      const off = bot({ startReact: 0 });
      off.store.viewFor("prefrontal").setGoal(goal([{ when: "creeper", skill: "flee", onStartle: true }]));
      await off.tick();
      expect((await off.tick({ bang: 0.9 })).proposals.map((p) => ("skill" in p.action ? p.action.skill : ""))).toEqual(["brace"]);
    });
  });

  describe("loaded responses and hold-backs", () => {
    it("fires the goal's response the moment its thing appears, at 0.95, and stops when the goal changes", async () => {
      const { store, tick, value } = bot();
      await tick();
      store.viewFor("prefrontal").setGoal({ text: "explore", steps: [], reason: "", ifThen: [{ when: "creeper", skill: "flee" }] });
      const out = await tick({ things: [{ id: "entity:1", kind: "creeper" }] });
      expect(out.proposals).toEqual([{ action: { skill: "flee", target: "entity:1" }, urgency: 0.95, reason: "loaded response: creeper appeared" }]);
      expect(out.trace).toMatchObject({ loadedResponse: { when: "creeper", skill: "flee", thing: "entity:1" } });

      store.viewFor("prefrontal").setGoal({ text: "go home", steps: [], reason: "" });
      const later = await tick({ things: [{ id: "entity:1", kind: "creeper" }, { id: "entity:2", kind: "creeper" }] }, null, 10_000);
      expect(later.proposals).toEqual([]);
    });

    it("logs responses it had to drop, and hold-backs it ignores", async () => {
      const { store, tick } = bot();
      await tick();
      store.viewFor("prefrontal").setGoal({ text: "g", steps: [], reason: "", ifThen: [{ when: "creeper", skill: "fly" }], holdBack: ["flee", "last_stand"] });
      const out = await tick();
      expect(out.trace).toMatchObject({ droppedResponses: [{ rule: { when: "creeper", skill: "fly" }, why: "unknown skill" }], ignoredHoldBack: ["last_stand"], holdingBack: ["flee"] });
    });
  });

  describe("body signals", () => {
    it("shares stuck and sore, and leaves the vital signs to the medulla", async () => {
      const { tick, value } = bot();
      await tick({ health: 0.8 });
      expect([value("stuck"), value("sore")]).toEqual([0, 0]);
      expect([value("air"), value("hunger"), value("pain")]).toEqual([undefined, undefined, undefined]);
    });
  });

  it("shares stuck: 1 while the legs are stuck, then fading over about 5 seconds", async () => {
    const stuck = { current: false };
    const { tick, value } = bot({}, { body: () => ({ health: 1, stuck: stuck.current }) });
    await tick();
    expect(value("stuck")).toBe(0);
    stuck.current = true;
    await tick();
    expect(value("stuck")).toBe(1);
    stuck.current = false;
    await tick({}, null, 1000);
    expect(value("stuck")).toBeGreaterThan(0.4);
    await tick({}, null, 5000);
    expect(value("stuck")).toBeLessThan(0.05);
  });

  it("with every strength at 0 it proposes nothing and shares nothing", async () => {
    const off = { gains: 0, startle: 0, loadedResponses: 0, holdBack: 0, bodySignals: 0 };
    const { store, tick } = bot(off);
    store.viewFor("prefrontal").setGoal({ text: "g", steps: [], reason: "", ifThen: [{ when: "zombie", skill: "flee" }] });
    await tick({ asleep: true }, "sleep");
    const out = await tick({ asleep: true, bang: true, health: 0.5, things: [{ id: "entity:1", kind: "zombie" }] }, "sleep");
    expect(out.proposals).toEqual([]);
    expect(Object.keys(store.signals())).toEqual([]);
  });

  describe("g) defence signals", () => {
    type Mode = "none" | "wary" | "freeze" | "flee" | "fight";
    const reading = (mode: Mode, threat: number) => ({
      choice: { mode, base: 0, why: `${mode} it`, target: mode === "none" ? null : "t1", threat, flightDistance: 8, cornered: false, coming: 0 },
      threats: mode === "none" ? [] : [{ id: "t1", kind: "zombie", dist: 6, stage: "coming" as const, noticed: true, canReach: true, escapable: true, danger: 0.5, beatable: true, flightDistance: 8 }],
    });
    const defending = (over: Partial<BrainstemOptions> = {}) => {
      const now = { mode: "none" as Mode, threat: 0 };
      return { now, ...bot({}, { defence: () => reading(now.mode, now.threat), ...over }) };
    };

    it("shares threat and wary from the defence chosen, and logs it with each threat", async () => {
      const { now, tick, value } = defending();
      await tick();
      expect([value("threat"), value("wary"), value("analgesia"), value("recovering")]).toEqual([0, 0, 0, 0]);
      Object.assign(now, { mode: "wary", threat: 0.3 });
      await tick();
      expect([value("threat"), value("wary")]).toEqual([0.3, 1]);
      Object.assign(now, { mode: "flee", threat: 0.8 });
      const out = await tick();
      expect([value("threat"), value("wary")]).toEqual([0.8, 0]);
      expect(out.trace?.defence).toMatchObject({ mode: "flee", why: "flee it", target: "t1", flightDistance: 8, cornered: false, threats: [{ kind: "zombie", stage: "coming" }] });
      expect(out.proposals).toEqual([]);
    });

    it("shares analgesia while fleeing or fighting, fading afterwards", async () => {
      const { now, tick, value } = defending();
      Object.assign(now, { mode: "fight", threat: 1 });
      await tick();
      await tick({}, null, 3000);
      expect(value("analgesia")).toBeGreaterThan(0.6);
      Object.assign(now, { mode: "none", threat: 0 });
      await tick({}, null, 12_000);
      expect(value("analgesia")).toBeLessThan(0.05);
    });

    it("soreness does not enlarge a startle while fleeing or fighting", async () => {
      const magnitude = async (mode: Mode) => {
        const { now, tick } = defending({ body: () => ({ health: 1, sore: 1 }) });
        Object.assign(now, { mode, threat: mode === "none" ? 0 : 0.8 });
        await tick();
        return ((await tick({ bang: 0.5 })).trace?.startle as { potentiation: number }).potentiation;
      };
      expect(await magnitude("none")).toBeGreaterThan(1);
      expect(await magnitude("flee")).toBe(1);
    });

    it("shares recovering after a flight that left the body hurt, with the strength at 0 never", async () => {
      const run = async (recuperate: number) => {
        const { now, tick, value } = defending({ defenceStrengths: { analgesia: 1, recuperate } });
        Object.assign(now, { mode: "flee", threat: 0.8 });
        await tick({ health: 0.4 });
        Object.assign(now, { mode: "none", threat: 0 });
        await tick({ health: 0.4 });
        return value("recovering");
      };
      expect(await run(1)).toBe(1);
      expect(await run(0)).toBe(0);
    });

    it("shares no defence signals when it is given no defence", async () => {
      const { tick, value } = bot();
      await tick();
      expect([value("threat"), value("wary"), value("analgesia")]).toEqual([undefined, undefined, undefined]);
    });
  });

  describe("arousal and startle", () => {
    const magnitude = async (arousal: number, arousalStartle = 1) => {
      const { tick } = bot({ arousalStartle }, { arousalOf: () => arousal });
      await tick();
      const out = await tick({ bang: 0.5 });
      return ((out.trace?.startle ?? out.trace?.startleQuiet) as { magnitude: number }).magnitude;
    };
    it("a drowsy body startles a little less, an over-aroused one a little more", async () => {
      const [drowsy, awake, alert, over] = [await magnitude(0.3), await magnitude(0.5), await magnitude(0.8), await magnitude(1)];
      expect(drowsy).toBeCloseTo(awake * 0.8, 1);
      expect(alert).toBe(awake);
      expect(over).toBeCloseTo(awake * 1.1, 1);
    });
    it("not at all with the strength at 0", async () => {
      expect(await magnitude(0.2, 0)).toBe(await magnitude(0.5, 0));
    });
  });
});
