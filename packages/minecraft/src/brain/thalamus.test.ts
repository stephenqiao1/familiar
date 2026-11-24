import { createWorkspace } from "@familiar/core";
import { createThalamusRegion, DEFAULT_THALAMUS, THALAMUS_OFF, type Form, type ThalamusOptions } from "@familiar/region-thalamus";
import { describe, expect, it } from "vitest";
import { fakeData, fakeState, inView } from "../encode/state.test-helper.js";
import type { MinecraftStateData } from "../encode/state-data.js";
import { thingsInView } from "./cues.js";
import { createFieldOfView } from "./field-of-view.js";
import { describeSituation } from "./situation.js";
import { nearest, playerThalamus } from "./thalamus.js";
import { splitState } from "./thalamus-channels.js";

const signal = new AbortController().signal;
const BEHIND = { side: "behind" as const, angle: 180 };
const mob = (i: number, over: object = {}) => ({ id: `entity:${i}`, type: i % 2 ? "zombie" : "cow", dist: i + 3, hostile: i % 2 === 1, reachable: true, ...inView(), ...over });
/** Fifteen mobs, nearest first; every third is out of view. */
const mobs = Array.from({ length: 15 }, (_, i) => mob(i, i % 3 === 2 ? { seen: false, bearing: BEHIND } : {}));
const hazards = Array.from({ length: 12 }, (_, i) => ({ id: `pos:${i},62,5`, type: "lava", dist: i + 1 }));
const crowd = { nearby: { mobs, hazards } };
const dataOf = (s: { data: Record<string, unknown> }) => s.data as unknown as MinecraftStateData;

/** What the deciding layers were told before there was a thalamus: the state already cut to `count` by the encoder, then the field of view. */
function before(patch: Parameters<typeof fakeState>[0], count: number, fieldOfView: boolean) {
  const data = fakeData(patch);
  const cutByEncoder = fakeState({ ...patch, nearby: { ...data.nearby, mobs: data.nearby.mobs.slice(0, count), hazards: data.nearby.hazards.slice(0, count), blocks: data.nearby.blocks.slice(0, count), players: data.nearby.players.slice(0, count) } });
  return fieldOfView ? createFieldOfView().tell(cutByEncoder) : cutByEncoder;
}

function told(patch: Parameters<typeof fakeState>[0], count: number, fieldOfView: number, withRegion = true) {
  const store = createWorkspace();
  store.update(fakeState(patch), null);
  if (withRegion) void createThalamusRegion({ ...playerThalamus(), readers: ["instinct", "prefrontal"], settings: { ...THALAMUS_OFF, fieldOfView }, nearby: () => count }).run(store.viewFor("thalamus"), signal);
  return store.viewFor("reader");
}

describe("nearest", () => {
  it("keeps the nearest few of each kind, and is the state itself when nothing is cut", () => {
    const state = fakeState(crowd);
    const cut = dataOf(nearest(state, 10));
    expect(cut.nearby.mobs.map((m) => m.id)).toEqual(mobs.slice(0, 10).map((m) => m.id));
    expect(cut.nearby.hazards).toHaveLength(10);
    expect(nearest(state, 15)).toBe(state);
    expect(dataOf(state).nearby.mobs).toHaveLength(15);
  });

  it("what the state says elsewhere of a cut thing goes with it", () => {
    const far = mob(14, { seen: false, bearing: BEHIND, dist: 6, hostile: true });
    const state = fakeState({
      nearby: {
        mobs: [...mobs.slice(0, 10), far],
        sudden: [
          { id: "entity:14", what: "appeared", bearing: BEHIND, dist: 6 },
          { id: "entity:0", what: "appeared", bearing: BEHIND, dist: 3 },
          { id: "entity:99", what: "looming", bearing: BEHIND, dist: 9 },
        ],
        heard: [
          { type: "presence", bearing: BEHIND, dist: 6, position: { x: 0, y: 64, z: 6 }, loudness: 0.2 },
          { type: "explosion", bearing: BEHIND, dist: 6, position: { x: 0, y: 64, z: 6 }, loudness: 1 },
        ],
      },
    });
    const cut = dataOf(nearest(state, 10)).nearby;
    // The cut mob's own news and its stand-in footsteps go; a projectile and a real sound stay.
    expect(cut.sudden.map((s) => s.id)).toEqual(["entity:0", "entity:99"]);
    expect(cut.heard.map((h) => h.type)).toEqual(["explosion"]);
  });
});

describe("the deciding layers are told what they were told before", () => {
  for (const fieldOfView of [0, 1]) {
    it(`the view, Jev's targets and the planner's text are the same (field of view ${fieldOfView ? "on" : "off"})`, () => {
      const old = before(crowd, 10, fieldOfView > 0);
      const ws = told(crowd, 10, fieldOfView);
      expect(ws.view("instinct")).toEqual(old);
      expect(ws.view("prefrontal")).toEqual(old);
      expect(thingsInView(ws.view("instinct")).map((t) => t.id)).toEqual(thingsInView(old).map((t) => t.id));
      // The planner's text, against the same text made from the old state.
      const oldStore = createWorkspace();
      oldStore.update(old, null);
      expect(describeSituation(ws, [])).toBe(describeSituation(oldStore.viewFor("prefrontal"), []));
      // The brain's own state still has all fifteen.
      expect(dataOf(ws.state).nearby.mobs).toHaveLength(15);
    });
  }

  it("with the thalamus left out the deciding layers read the full state", () => {
    const ws = told(crowd, 10, 1, false);
    expect(ws.view("instinct")).toBe(ws.state);
    expect(describeSituation(ws, [])).toContain("zombie");
    expect(thingsInView(ws.view("instinct"))).toHaveLength(27);
  });
});

describe("channels and forms", () => {
  const zombie = { ...mob(1, { dist: 9 }), type: "zombie", hostile: true, closing: 1.2, speed: 1.2, elevation: -5, height: 1.95, light: 12 };
  const cow = { ...mob(2, { dist: 5 }), type: "cow", hostile: false };
  const chest = { id: "pos:3,64,3", type: "chest", dist: 4, ...inView() };
  const steve = { id: "entity:7", type: "player", dist: 6, ...inView() };
  const lava = { id: "pos:1,63,1", type: "lava", dist: 2 };
  const far = { id: "pos:6,63,1", type: "lava", dist: 7 };
  const sound = { type: "door", bearing: BEHIND, dist: 5, position: { x: 0, y: 64, z: 5 }, loudness: 0.5, msAgo: 100 };
  const arrow = { id: "entity:9", what: "looming" as const, bearing: BEHIND, dist: 12 };
  const state = fakeState({ nearby: { mobs: [cow, zombie], blocks: [chest], players: [steve], hazards: [lava, far], heard: [sound], sudden: [arrow, { id: "entity:2", what: "appeared", bearing: BEHIND, dist: 5 }] } });
  const split = splitState(state);
  const channel = (name: string) => split.channels.find((c) => c.name === name)!;
  const all = (form: Form) => new Map(split.channels.flatMap((c) => c.items.map((i) => [i.id, form] as const)));
  const none = { heldBack: {}, new: [] };

  it("splits the nearby lists into channels; the body is not a channel (it is always passed whole)", () => {
    expect(split.channels.map((c) => c.name).sort()).toEqual(["changes", "creatures", "hazards", "players", "sounds", "things", "threats"]);
    expect(channel("threats").items.map((i) => i.id)).toEqual(["entity:1"]);
    expect(channel("creatures").items).toMatchObject([{ id: "entity:2", kind: "cow", dist: 5, fresh: true }]);
    expect(channel("things").items.map((i) => i.kind)).toEqual(["chest"]);
    expect(channel("players").items.map((i) => i.id)).toEqual(["entity:7"]);
    expect(channel("sounds").items).toMatchObject([{ kind: "door", fresh: true }]);
    // A projectile coming at the body is on no list: it is its own item, and it presses.
    expect(channel("changes").items).toMatchObject([{ id: "entity:9", threat: 2 }]);
    // A hazard within 3 blocks is never held back.
    expect(channel("hazards").items.map((i) => i.vital)).toEqual([true, false]);
    expect(split.fixed).toBeGreaterThan(JSON.stringify(dataOf(state).self).length);
  });

  it("the costs are the sizes: fixed plus every full form is the size of the state, within a few characters", () => {
    const total = split.fixed + split.channels.flatMap((c) => c.items).reduce((sum, i) => sum + i.cost.full, 0);
    expect(Math.abs(total - JSON.stringify(state).length)).toBeLessThan(12);
    for (const item of split.channels.flatMap((c) => c.items)) expect(item.cost.brief).toBeLessThanOrEqual(item.cost.full);
  });

  it("everything in full puts the same state back together", () => {
    expect(split.assemble(all("full"), none)).toEqual(state);
  });

  it("a brief form is id, kind, distance and bearing; nothing in a view is changed or made up", () => {
    const view = dataOf(split.assemble(all("brief"), none));
    expect(view.nearby.mobs[1]).toEqual({ id: "entity:1", type: "zombie", dist: 9, bearing: zombie.bearing, hostile: true, reachable: true });
    expect(view.nearby.blocks[0]).toEqual({ id: "pos:3,64,3", type: "chest", dist: 4, bearing: chest.bearing });
    const original = dataOf(state);
    for (const list of ["mobs", "blocks", "players", "hazards"] as const) {
      for (const shown of view.nearby[list]) {
        const whole = original.nearby[list].find((t) => t.id === shown.id)! as unknown as Record<string, unknown>;
        for (const [key, value] of Object.entries(shown)) expect(whole[key]).toEqual(value);
      }
    }
    // The body, the time and the defence's choice are the state's own.
    expect(view.self).toBe(original.self);
    expect(view.time).toBe(original.time);
  });

  it("what is only counted is left out and noted beside the view", () => {
    const forms = all("counted");
    forms.set("entity:1", "full");
    const view = dataOf(split.assemble(forms, { heldBack: { creatures: 1, hazards: 2 }, new: ["entity:2"] }));
    expect(view.nearby.mobs.map((m) => m.id)).toEqual(["entity:1"]);
    expect(view.nearby.hazards).toEqual([]);
    expect(view.told).toEqual({ heldBack: { creatures: 1, hazards: 2 }, new: ["entity:2"] });
    expect(dataOf(state).told).toBeUndefined();
    // The planner is told what it is not shown.
    const store = createWorkspace();
    store.update(state, null);
    store.viewFor("thalamus").setView("prefrontal", split.assemble(forms, { heldBack: { creatures: 1, hazards: 2 }, new: ["entity:2"] }));
    const text = describeSituation(store.viewFor("prefrontal"), []);
    expect(text).toContain("Not shown");
    expect(text).toContain("1 more creatures, 2 more hazards");
    expect(text).toContain("Just appeared: entity:2");
  });
});

describe("the gate on the player's state", () => {
  const animals = Array.from({ length: 30 }, (_, i) => ({ ...mob(i + 10, { dist: 3 + (i % 12) }), type: i % 2 ? "cow" : "sheep", hostile: false }));
  // A husk six blocks off and walking at the bot: by the defence's own rules it is coming.
  const husk = { ...mob(1, { dist: 6, closing: 1.5 }), type: "husk", hostile: true };
  const hazards = Array.from({ length: 20 }, (_, i) => ({ id: `pos:${i},62,5`, type: "drop", dist: 2 + i }));
  const crowd = { nearby: { mobs: [...animals, husk].sort((a, b) => a.dist - b.dist), hazards } };

  function gated(patch: Parameters<typeof fakeState>[0], over: Partial<ThalamusOptions> = {}, limits = DEFAULT_THALAMUS.limits) {
    const store = createWorkspace();
    store.update(fakeState(patch), null);
    const out = createThalamusRegion({ ...playerThalamus(), readers: ["instinct", "prefrontal"], settings: { ...DEFAULT_THALAMUS, limits }, ...over }).run(store.viewFor("thalamus"), signal) as { trace: Record<string, any> };
    return { ws: store.viewFor("reader"), trace: out.trace };
  }

  it("a crowd of thirty animals and one hostile: the view stays inside its limit and holds the hostile in full", () => {
    const { ws, trace } = gated(crowd);
    for (const reader of ["instinct", "prefrontal"]) {
      const view = ws.view(reader);
      const limit = DEFAULT_THALAMUS.limits[reader]!;
      expect(dataOf(view).nearby.mobs.find((m) => m.id === husk.id)).toEqual(husk);
      // The body and the pressing threat are never held back; when they alone pass the limit, that is logged.
      if (trace.views[reader].over) expect(trace.views[reader].warning).toMatch(/over the limit/);
      else expect(JSON.stringify(view).length).toBeLessThanOrEqual(limit + 100);
      const held = dataOf(view).told?.heldBack ?? {};
      expect(dataOf(view).nearby.mobs.length + (held.creatures ?? 0)).toBe(31);
    }
    expect(JSON.stringify(ws.view("prefrontal")).length).toBeLessThanOrEqual(4100);
    expect(JSON.stringify(ws.state).length).toBeGreaterThan(5000);
  });

  it("Jev is offered only targets that are in its view, in full or in brief", () => {
    const { ws } = gated(crowd);
    const offered = thingsInView(ws.view("instinct")).map((t) => t.id);
    const inView = new Set([...dataOf(ws.view("instinct")).nearby.mobs, ...dataOf(ws.view("instinct")).nearby.hazards].map((t) => t.id));
    expect(offered.every((id) => inView.has(id))).toBe(true);
    expect(offered.length).toBeLessThan(thingsInView(ws.state).length);
  });

  it("a hazard within 3 blocks and a pressing threat survive a tiny limit", () => {
    const { ws, trace } = gated(crowd, {}, { instinct: 10, prefrontal: 10 });
    const view = dataOf(ws.view("instinct"));
    expect(view.nearby.hazards.map((h) => h.dist)).toEqual([2, 3]);
    expect(view.nearby.mobs.map((m) => m.id)).toEqual([husk.id]);
    expect(view.self).toEqual(dataOf(ws.state).self);
    expect(trace.views.instinct.over).toBeGreaterThan(0);
  });

  it("every strength at 0 gives the views of the attention budget, as before the gate", () => {
    const store = createWorkspace();
    store.update(fakeState(crowd), null);
    void createThalamusRegion({ ...playerThalamus(), readers: ["instinct"], settings: THALAMUS_OFF, nearby: () => 10 }).run(store.viewFor("thalamus"), signal);
    expect(store.viewFor("x").view("instinct")).toEqual(nearest(fakeState(crowd), 10));
  });
});
