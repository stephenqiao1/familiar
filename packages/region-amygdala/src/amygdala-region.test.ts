import type { Attended, State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { describe, expect, it } from "vitest";
import { createAmygdalaRegion, type AmygdalaOptions } from "./amygdala-region.js";
import { createAssociations, harmOf } from "./association.js";
import type { Outcome } from "./learn.js";
import type { Cue } from "./presence.js";
import { DEFAULT_AMYGDALA } from "./settings.js";

const state = (timestamp: number): State => ({ schemaVersion: 1, tick: 0, timestamp, data: {} });

/** Runs a script of ticks: what is around and what happens at each. */
function play(script: { cues: Cue[]; outcomes?: Outcome[]; area?: string }[], over: Partial<AmygdalaOptions> = {}, stepMs = 250, attended: Attended | null = null) {
  const store = over.store ?? createAssociations();
  const ws = createWorkspace();
  let tick = 0;
  const region = createAmygdalaRegion({ store, cues: () => script[tick]!.cues, outcomes: () => script[tick]!.outcomes ?? [], area: () => script[tick]!.area ?? "field", ...over });
  const view = ws.viewFor("amygdala");
  if (attended) view.setAttended(attended);
  const traces: Record<string, unknown>[] = [];
  for (; tick < script.length; tick++) {
    ws.update(state(tick * stepMs), null);
    const out = region.run(view, new AbortController().signal) as { proposals: unknown[]; trace: Record<string, unknown> };
    expect(out.proposals).toEqual([]);
    traces.push(out.trace);
  }
  return { store, traces, signals: view.signals, attended: view.attended };
}

const wolf: Cue = { key: "kind:wolf", salience: 1 };
const bite: Outcome = { sign: "harm", size: 0.4, what: "lost 8 health to wolf", points: ["kind:wolf"] };

describe("the amygdala region", () => {
  it("learns from what follows the cues around, and says so in its trace", () => {
    const { store, traces } = play([{ cues: [wolf] }, { cues: [wolf], outcomes: [bite] }, { cues: [wolf] }]);
    expect(store.get("kind:wolf")!.harm).toBeGreaterThan(0.1);
    expect(traces[0]!.fear).toBe(0);
    expect(traces[2]!.fear).toBeGreaterThan(0.1);
    expect((traces[1]!.learned as { after: string }[])[0]!.after).toBe("lost 8 health to wolf");
  });

  it("blames a cue seen a few seconds before, not one long gone", () => {
    const quiet = { cues: [] };
    const soon = play([{ cues: [wolf] }, ...Array(8).fill(quiet), { cues: [], outcomes: [bite] }]);
    expect(soon.store.get("kind:wolf")!.harm).toBeGreaterThan(0);
    const late = play([{ cues: [wolf] }, ...Array(40).fill(quiet), { cues: [], outcomes: [bite] }]);
    expect(late.store.get("kind:wolf")!.harm).toBe(0);
  });

  it("shares fear, appeal and what matters: the strongest among the cues around, not their sum", () => {
    const store = createAssociations({ "kind:wolf": { harm: 0.6, good: 0, sure: 1, at: 0 }, "kind:crow": { harm: 0.5, good: 0, sure: 1, at: 0 }, "kind:berry": { harm: 0, good: 0.3, sure: 1, at: 0 } });
    const cues = [wolf, { key: "kind:crow", salience: 0.3 }, { key: "kind:berry", salience: 0.3 }];
    const { signals } = play([{ cues }], { store });
    expect(signals.fear!.value).toBeCloseTo(0.6);
    expect(signals.appeal!.value).toBeCloseTo(0.3);
    expect(signals.matters!.value).toBeCloseTo(0.6);
    expect(play([{ cues: [] }], { store }).signals.fear!.value).toBe(0);
  });

  it("a sign of safety around takes that much off the fear", () => {
    const store = createAssociations({ "kind:wolf": { harm: 0.6, good: 0, sure: 1, at: 0 }, "area:den": { harm: -0.4, good: 0, sure: 1, at: 0 } });
    expect(play([{ cues: [wolf, { key: "area:den", salience: 0.2 }] }], { store }).signals.fear!.value).toBeCloseTo(0.2);
  });

  it("tells the thing attended to how much harm it predicts", () => {
    const store = createAssociations({ "kind:wolf": { harm: 0.6, good: 0, sure: 1, at: 0 } });
    const thing: Attended = { id: "entity:1", kind: "wolf", bearing: "ahead", salience: 1, since: 0 };
    expect(play([{ cues: [wolf] }], { store, cueOf: (t) => `kind:${t.kind}` }, 250, thing).attended).toMatchObject({ id: "entity:1", harm: 0.6 });
    expect(play([{ cues: [wolf] }], { store }, 250, thing).attended!.harm).toBeUndefined();
  });

  it("says when a fear has come back: in another place, with no new harm", () => {
    const store = createAssociations({ "kind:wolf": { harm: 0.8, good: 0, sure: 1, at: 0, safe: { yard: { value: 0.9, at: 0 } } } });
    const { traces } = play([{ cues: [wolf], area: "yard" }, { cues: [wolf], area: "cave" }, { cues: [wolf], area: "cave" }], { store });
    expect(traces[0]!.returned).toBeUndefined();
    expect(traces[1]!.returned).toMatchObject([{ cue: "kind:wolf", why: expect.stringContaining("another place") }]);
    expect(traces[2]!.returned).toBeUndefined();
  });

  it("counts the cues that tagged along and were not blamed", () => {
    const store = createAssociations({ "kind:wolf": { harm: 0.4, good: 0, sure: 1, at: 0 } });
    const { traces } = play([{ cues: [wolf, { key: "kind:crow", salience: 0.3 }] }, { cues: [wolf, { key: "kind:crow", salience: 0.3 }], outcomes: [bite] }], { store });
    expect((traces[1]!.learned as { spared: number; rated: number }[])[0]).toMatchObject({ spared: 2, rated: 0.4 });
    expect(store.get("kind:crow")!.harm).toBeLessThan(0.001);
  });

  it("a hurtful thing only seen from a distance is not found safe by it", () => {
    const lava = { key: "block:lava", salience: 0.15 };
    const far = createAssociations({ "block:lava": { harm: 0.8, good: 0, sure: 1, at: 0 } });
    play(Array(600).fill({ cues: [{ ...lava, apart: true }], area: "cave" }), { store: far }, 1000);
    expect(harmOf(far.get("block:lava"), "cave", 600_000)).toBeCloseTo(0.8, 1);
    const touched = createAssociations({ "block:lava": { harm: 0.8, good: 0, sure: 1, at: 0 } });
    play(Array(600).fill({ cues: [lava], area: "cave" }), { store: touched }, 1000);
    expect(harmOf(touched.get("block:lava"), "cave", 600_000)).toBeLessThan(0.5);
  });

  it("replay is not an experience: with no outcome from the body, nothing is learned however often a cue comes round", () => {
    const { store } = play(Array(20).fill({ cues: [wolf] }));
    expect(store.get("kind:wolf")).toMatchObject({ harm: 0, good: 0 });
  });

  it("starts a cue from what it is born with, or from a similar one", () => {
    const store = createAssociations({ "kind:wolf": { harm: 0.8, good: 0, sure: 1, at: 0 } });
    const { traces } = play([{ cues: [{ key: "kind:dog", salience: 1 }, { key: "kind:zombie", salience: 0.3, born: { harm: 0.5 } }] }], { store, alike: () => 0.5 });
    expect(store.get("kind:dog")!.harm).toBeCloseTo(0.2, 5);
    expect(store.get("kind:zombie")!.born).toEqual({ harm: 0.5, good: 0 });
    expect(traces[0]!.begun).toEqual([{ cue: "kind:dog", harm: 0.2, good: 0, like: "kind:wolf" }, { cue: "kind:zombie", harm: 0.5, good: 0, born: true }]);
  });

  it("a feared thing that keeps being harmless here becomes safe here, and stays feared elsewhere", () => {
    const store = createAssociations({ "kind:wolf": { harm: 0.8, good: 0, sure: 1, at: 0 } });
    play(Array(60 * 30).fill({ cues: [wolf], area: "yard" }), { store }, 1000);
    const now = 60 * 30 * 1000;
    expect(harmOf(store.get("kind:wolf"), "yard", now)).toBeLessThan(0.3);
    expect(harmOf(store.get("kind:wolf"), "cave", now)).toBeGreaterThan(0.5);
  });

  it("holds inborn beliefs from the first tick, met or not", () => {
    const { store } = play([{ cues: [] }], { born: { "food:toadstool": { harm: 0.8 } } });
    expect(harmOf(store.get("food:toadstool"), null, 0)).toBe(0.8);
  });

  it("leaves signs out when signs are off", () => {
    const sign: Cue = { key: "sign:danger|creeper", salience: 0.5 };
    const hurt: Outcome = { sign: "harm", size: 0.5, what: "hurt" };
    expect(play([{ cues: [sign], outcomes: [hurt] }]).store.get(sign.key)!.harm).toBeGreaterThan(0);
    expect(play([{ cues: [sign], outcomes: [hurt] }], { settings: { ...DEFAULT_AMYGDALA, signs: 0 } }).store.get(sign.key)).toBeUndefined();
  });

  it("is the same every time it is run on the same ticks", () => {
    const script = [{ cues: [wolf] }, { cues: [wolf, { key: "area:a", salience: 0.2 }], outcomes: [bite] }, { cues: [] }, { cues: [wolf], outcomes: [{ sign: "good" as const, size: 0.3, what: "hunger eased" }] }];
    expect(play(script).store.entries()).toEqual(play(script).store.entries());
  });

  it("stays well inside a millisecond a tick with fifty cues around", () => {
    const many: Cue[] = Array.from({ length: 50 }, (_, i) => ({ key: `kind:thing${i}`, salience: 0.3 }));
    const { traces } = play(Array(400).fill({ cues: many, outcomes: [bite] }));
    const worst = traces.slice(20).map((t) => (t.slow ? 1 : 0)).reduce((a: number, b) => a + b, 0);
    expect(worst).toBeLessThan(8);
  });
});
