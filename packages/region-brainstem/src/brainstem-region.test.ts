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
  bang?: boolean;
  things?: { id: string; kind: string }[];
}
const world = (state: State) => state.data as World;

function bot(settings: Partial<BrainstemSettings> = {}, over: Partial<BrainstemOptions> = {}) {
  const store = createWorkspace();
  const region = createBrainstemRegion({
    settings: { ...DEFAULT_BRAINSTEM, ...settings },
    alarmOf: (ws) => ws.signals.alarm?.value ?? 0,
    hardReflex: (ws) => (ws.signals.hard_reflex?.value ?? 0) > 0,
    startle: [{ name: "bang", check: ({ after }) => (world(after).bang ? { source: world(after).things?.[0] ?? null } : null) }],
    novel: ({ before, after }) => (world(after).things ?? []).find((t) => !(world(before).things ?? []).some((b) => b.id === t.id)) ?? null,
    mayOrient: (ws) => ws.current === null || ws.current.skill === "idle",
    thingsOf: (state) => world(state).things ?? [],
    responseProblem: (skill) => (skill === "flee" ? null : "unknown skill"),
    acceptsTarget: () => true,
    holdable: ["flee", "defend"],
    asleep: (ws) => world(ws.state).asleep ?? false,
    drowsy: (ws) => world(ws.state).night ?? false,
    body: (state) => ({ health: world(state).health ?? 1 }),
    skills: { brace: "brace", lookAt: "look_at" },
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
    it("shares startle for one tick and proposes bracing toward the source, once", async () => {
      const { tick, value } = bot();
      await tick();
      const out = await tick({ bang: true, things: [{ id: "entity:1", kind: "zombie" }] });
      expect(value("startle")).toBe(1);
      expect(out.proposals).toContainEqual({ action: { skill: "brace", target: "entity:1" }, urgency: 1, reason: "startled: bang" });
      expect(out.trace).toMatchObject({ startle: { by: "bang" } });
      const next = await tick({ bang: true, things: [{ id: "entity:1", kind: "zombie" }] });
      expect(value("startle")).toBe(0);
      expect(next.proposals.some((p) => "skill" in p.action && p.action.skill === "brace")).toBe(false);
    });

    it("fires at most once per 5 seconds", async () => {
      const { tick, value } = bot();
      await tick();
      await tick({ bang: true });
      expect(value("startle")).toBe(1);
      await tick({ bang: true }, null, 4000);
      expect(value("startle")).toBe(0);
      await tick({ bang: true }, null, 1500);
      expect(value("startle")).toBe(1);
    });
  });

  describe("orienting", () => {
    it("proposes a weak look at something new, only when idle or doing nothing", async () => {
      const { tick, value } = bot();
      await tick();
      const out = await tick({ things: [{ id: "entity:1", kind: "zombie" }] });
      expect(value("orienting")).toBe(1);
      expect(out.proposals).toEqual([{ action: { skill: "look_at", target: "entity:1" }, urgency: 0.35, reason: "something new: zombie" }]);
      const idle = await tick({ things: [{ id: "entity:1", kind: "zombie" }, { id: "entity:2", kind: "cow" }] }, "idle");
      expect(idle.proposals).toHaveLength(1);
    });

    it("stays quiet when a reflex, a startle or a loaded response has spoken this tick", async () => {
      const reflex = bot({}, { reflexFired: () => true });
      await reflex.tick();
      expect((await reflex.tick({ things: [{ id: "entity:1", kind: "zombie" }] })).proposals).toEqual([]);
      const startled = bot();
      await startled.tick();
      const out = await startled.tick({ bang: true, things: [{ id: "entity:1", kind: "zombie" }] });
      expect(out.proposals.map((p) => ("skill" in p.action ? p.action.skill : ""))).toEqual(["brace"]);
    });

    it("never interrupts a running skill other than idle", async () => {
      const { tick, value } = bot();
      await tick({}, "go_to");
      const out = await tick({ things: [{ id: "entity:1", kind: "zombie" }] }, "go_to");
      expect(value("orienting")).toBe(1);
      expect(out.proposals).toEqual([]);
      expect(out.trace).toMatchObject({ orienting: { toward: "entity:1", proposed: false } });
    });
  });

  describe("loaded responses and hold-backs", () => {
    it("fires the goal's response the moment its thing appears, at 0.95, and stops when the goal changes", async () => {
      const { store, tick } = bot({ orienting: 0 });
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

  describe("arousal gate", () => {
    it("asleep and calm: arousal is at its floor and the upper layers are paused", async () => {
      const { tick, value } = bot();
      await tick({ asleep: true }, "sleep");
      const out = await tick({ asleep: true }, "sleep");
      expect(value("arousal")).toBeCloseTo(0.05);
      expect(value("upper_paused")).toBe(1);
      // With the deciding layers quiet, the brainstem speaks for staying asleep.
      expect(out.proposals).toEqual([{ action: { skill: "sleep" }, urgency: 0.5, reason: "asleep and undisturbed" }]);
    });

    it("damage, a startle, a hard reflex or alarm each end the pause on the same tick", async () => {
      const wakes: [string, (b: ReturnType<typeof bot>) => Promise<unknown>][] = [
        ["damage", (b) => b.tick({ asleep: true, health: 0.8 }, "sleep")],
        ["startle", (b) => b.tick({ asleep: true, bang: true }, "sleep")],
        ["hard reflex", (b) => (b.store.viewFor("reflex").setSignal("hard_reflex", 1), b.tick({ asleep: true }, "sleep"))],
        ["alarm", (b) => (b.store.viewFor("noradrenaline").setSignal("alarm", 0.6), b.tick({ asleep: true }, "sleep"))],
      ];
      for (const [why, wake] of wakes) {
        const b = bot();
        await b.tick({ asleep: true }, "sleep");
        expect(b.value("upper_paused")).toBe(1);
        const out = (await wake(b)) as { trace: Record<string, unknown> };
        expect(b.value("upper_paused"), why).toBe(0);
        expect(out.trace.woken, why).toBe(why);
      }
    });

    it("stays unpaused while the pain lasts, then lets the bot settle again", async () => {
      const { tick, value } = bot();
      await tick({ asleep: true }, "sleep");
      await tick({ asleep: true, health: 0.8 }, "sleep");
      await tick({ asleep: true, health: 0.8 }, "sleep", 2000);
      expect(value("upper_paused")).toBe(0);
      await tick({ asleep: true, health: 0.8 }, "sleep", 15_000);
      expect(value("upper_paused")).toBe(1);
    });

    it("is about 0.3 when drowsy, 0.5 awake, and rises toward 1 with alarm", async () => {
      const { store, tick, value } = bot();
      await tick({ night: true });
      expect(value("arousal")).toBeCloseTo(0.3);
      await tick();
      expect(value("arousal")).toBeCloseTo(0.5);
      store.viewFor("noradrenaline").setSignal("alarm", 1);
      await tick();
      expect(value("arousal")).toBeCloseTo(1);
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

  it("with every strength at 0 it proposes nothing and shares nothing but arousal", async () => {
    const off = { gains: 0, startle: 0, orienting: 0, loadedResponses: 0, holdBack: 0, arousalGate: 0, bodySignals: 0 };
    const { store, tick } = bot(off);
    store.viewFor("prefrontal").setGoal({ text: "g", steps: [], reason: "", ifThen: [{ when: "zombie", skill: "flee" }] });
    await tick({ asleep: true }, "sleep");
    const out = await tick({ asleep: true, bang: true, health: 0.5, things: [{ id: "entity:1", kind: "zombie" }] }, "sleep");
    expect(out.proposals).toEqual([]);
    expect(Object.keys(store.signals())).toEqual(["arousal"]);
  });
});
