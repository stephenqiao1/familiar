import { createWorkspace } from "@familiar/core";
import type { StartleHit } from "@familiar/region-brainstem";
import { describe, expect, it } from "vitest";
import { fakeData, fakeState, inView, type StatePatch } from "../encode/state.test-helper.js";
import { createPlayerStartles, roughPositionOf, selfCaused, startleSurroundings } from "./startle.js";

const HERE = { x: 0, y: 63, z: 0 };
const BEHIND = { side: "behind" as const, angle: 180 };
const zombie = (dist: number, id = 1, over = {}) => ({ id: `entity:${id}`, type: "zombie", dist, hostile: true, reachable: true, ...over });
const heard = (type: string, dist: number, loudness: number, msAgo = 40) => ({ type, dist, loudness, bearing: BEHIND, position: { x: 0, y: 63, z: dist }, msAgo });
const hurt = (by: string | null, kind: string | null, msAgo = 30) => ({ msAgo, by, kind, at: HERE });

/** A bot's detectors and workspace, fed one state at a time. Returns every detector's result for the step. */
function senses() {
  const store = createWorkspace();
  const detectors = createPlayerStartles();
  let before = fakeState();
  let ms = 0;
  const step = (patch: StatePatch = {}, afterMs = 500): Record<string, StartleHit> => {
    ms += afterMs;
    const after = fakeState(patch, ms);
    store.update(after, null);
    const ws = store.viewFor("brainstem");
    const hits = Object.fromEntries(detectors.flatMap((d) => { const hit = d.check({ before, after, ws }); return hit ? [[d.name, hit]] : []; }));
    before = after;
    return hits;
  };
  return { store, step };
}

describe("the player's startle detectors", () => {
  it("loud: intensity from how loud it is here and how sudden that kind of sound is; faces where it came from", () => {
    const { step } = senses();
    expect(step({ nearby: { heard: [heard("explosion", 9, 0.9)] } }).loud_nearby).toEqual({ source: { id: "pos:0,63,9", kind: "explosion" }, intensity: 0.9, kind: "explosion", place: "0,1", foreseen: 0, selfCaused: false, msAgo: 40 });
    // The same sound still in the list a tick later is not a new event.
    expect(step({ nearby: { heard: [heard("explosion", 9, 0.9)] } })).toEqual({});
    // A far bang is weaker; a door weaker still; an ordinary sound barely counts.
    expect(senses().step({ nearby: { heard: [heard("explosion", 40, 0.56)] } }).loud_nearby!.intensity).toBeCloseTo(0.56);
    expect(senses().step({ nearby: { heard: [heard("door", 3, 0.39)] } }).loud_nearby!.intensity).toBeCloseTo(0.27);
    expect(senses().step({ nearby: { heard: [heard("sound", 3, 0.39)] } }).loud_nearby!.intensity).toBeLessThan(0.25);
    // The stand-in for footsteps is not a sound event.
    expect(senses().step({ nearby: { heard: [heard("presence", 5, 0.2)] } })).toEqual({});
  });

  it("up close: a hostile first seen within 3 blocks, stronger the nearer it is and the faster it came", () => {
    const near = senses().step({ nearby: { mobs: [zombie(1)] } }).hostile_up_close!;
    const far = senses().step({ nearby: { mobs: [zombie(3)] } }).hostile_up_close!;
    expect(near).toMatchObject({ source: { id: "entity:1", kind: "zombie" }, kind: "zombie", cause: "hostile_appeared" });
    expect(near.intensity).toBeGreaterThan(far.intensity);
    const sudden = senses().step({ nearby: { mobs: [zombie(3)], sudden: [{ id: "entity:1", what: "appeared", bearing: BEHIND, dist: 3 }] } }).hostile_up_close!;
    expect(sudden.intensity).toBeGreaterThan(far.intensity);
    expect(senses().step({ nearby: { mobs: [zombie(5)] } })).toEqual({});
    // Seen coming from afar: it is not new when it arrives.
    const s = senses();
    s.step({ nearby: { mobs: [zombie(12)] } });
    expect(s.step({ nearby: { mobs: [zombie(2)] } })).toEqual({});
  });

  it("hurt from nowhere: by an attacker with no threat in view, stronger the more health it cost", () => {
    const light = senses().step({ self: { health: 19, lastHurt: hurt("entity:9", "mob_attack") } }).hurt_unseen!;
    const heavy = senses().step({ self: { health: 13, lastHurt: hurt("entity:9", "mob_attack") }, nearby: { mobs: [zombie(20, 9)] } }).hurt_unseen!;
    expect(light).toMatchObject({ source: null, cause: "damage", msAgo: 30 });
    expect(light.intensity).toBeCloseTo(0.49);
    expect(heavy).toMatchObject({ source: { id: "entity:9", kind: "zombie" }, intensity: 1 });
    // A threat was already in view: being hit is no surprise.
    const s = senses();
    s.step({ nearby: { mobs: [zombie(4)] } });
    expect(s.step({ self: { health: 17, lastHurt: hurt("entity:1", "mob_attack") }, nearby: { mobs: [zombie(4)] } })).toEqual({});
  });

  it("unexpected damage with no attacker: a fall is strong, a hunger or fire tick just enough to flinch at once", () => {
    const fall = senses().step({ self: { health: 15, lastHurt: hurt(null, "fall") } }).unexpected_damage!;
    expect(fall).toMatchObject({ source: null, kind: "hurt:fall", cause: "damage" });
    expect(fall.intensity).toBeCloseTo(0.79, 1);
    const starve = senses().step({ self: { health: 19, lastHurt: hurt(null, "starve") } }).unexpected_damage!;
    expect(starve).toMatchObject({ kind: "hurt:starve" });
    expect(starve.intensity).toBeGreaterThan(0.25);
    expect(starve.intensity).toBeLessThan(0.3);
    // No place: it travels with the body, so getting used to it does too.
    expect(starve.place).toBeUndefined();
    // An old hurt is not a new one.
    const s = senses();
    s.step({ self: { health: 19, lastHurt: hurt(null, "starve", 100) } });
    expect(s.step({ self: { health: 19, lastHurt: hurt(null, "starve", 600) } })).toEqual({});
  });

  it("looming: when something starts coming fast, once; a projectile is strong at once", () => {
    const s = senses();
    const arrow = { id: "entity:9", what: "looming" as const, bearing: BEHIND, dist: 12 };
    expect(s.step({ nearby: { sudden: [arrow] } }).looming).toMatchObject({ source: { id: "entity:9", kind: "unknown" }, intensity: 0.8, kind: "looming", cause: "looming" });
    expect(s.step({ nearby: { sudden: [arrow] } })).toEqual({});
    const charging = { ...zombie(12, 4), ...inView({ closing: 6 }) };
    expect(senses().step({ nearby: { mobs: [charging], sudden: [{ ...arrow, id: "entity:4" }] } }).looming).toMatchObject({ source: { kind: "zombie" }, intensity: 0.75 });
  });

  it("seen coming: the source was attended, or in view and approaching, in the last 2 seconds", () => {
    // Attended: the bot was looking at the lit fuse where the bang then happened.
    const s = senses();
    s.store.viewFor("colliculus").setAttended({ id: "pos:0,63,9", kind: "unknown", bearing: "behind", salience: 1, since: 0 });
    s.step();
    s.store.viewFor("colliculus").setAttended(null);
    expect(s.step({ nearby: { heard: [heard("explosion", 9, 0.9)] } }, 1000).loud_nearby!.foreseen).toBe(1);
    // Three seconds later that no longer counts.
    const late = senses();
    late.store.viewFor("colliculus").setAttended({ id: "pos:0,63,9", kind: "unknown", bearing: "behind", salience: 1, since: 0 });
    late.step();
    late.store.viewFor("colliculus").setAttended(null);
    late.step({}, 1500);
    expect(late.step({ nearby: { heard: [heard("explosion", 9, 0.9)] } }, 1500).loud_nearby!.foreseen).toBe(0);
    // In view and approaching: the attacker was watched walking up.
    const watched = senses();
    const coming = { ...zombie(20, 9, { hostile: false }), ...inView({ closing: 2 }) };
    watched.step({ nearby: { mobs: [coming] } });
    expect(watched.step({ self: { health: 17, lastHurt: hurt("entity:9", "mob_attack") }, nearby: { mobs: [coming] } }).hurt_unseen!.foreseen).toBe(1);
  });
});

describe("selfCaused", () => {
  const at = { x: 3, y: 63, z: 0 };
  const ws = (events: { skill: string; target?: string; changes?: Record<string, unknown>; msAgo: number }[], current: { skill: string; target?: string } | null = null, patch: StatePatch = {}) => {
    const store = createWorkspace();
    store.update(fakeState(patch, 10_000), current ? { skill: current.skill, target: current.target, startedAt: 0 } : null);
    for (const e of events) store.addEvent({ skill: e.skill, type: "done", timestamp: 10_000 - e.msAgo, ...(e.target ? { target: e.target } : {}), ...(e.changes ? { changes: e.changes } : {}) });
    return store.viewFor("brainstem");
  };
  const data = (patch: StatePatch = {}) => fakeData(patch);

  it("is true for an event where the bot just broke, placed, lit or opened something", () => {
    expect(selfCaused(data(), ws([{ skill: "place_block", changes: { targetAt: "3,63,1" }, msAgo: 4000 }]), at)).toBe(true);
    expect(selfCaused(data(), ws([{ skill: "use_on", changes: { targetAt: "3,63,0" }, msAgo: 500 }]), at)).toBe(true);
  });

  it("only within about 3 seconds and 8 blocks of the bot's own action", () => {
    expect(selfCaused(data(), ws([{ skill: "break_block", changes: { targetAt: "3,63,1" }, msAgo: 6000 }]), at)).toBe(false);
    expect(selfCaused(data(), ws([{ skill: "break_block", changes: { targetAt: "30,63,0" }, msAgo: 500 }]), at)).toBe(false);
  });

  it("is true for the noise of a thing the bot is striking, and false for an unrelated event straight after", () => {
    const mob = { ...zombie(3, 5), ...inView({ bearing: { side: "right", angle: -90 } }) };
    const patch = { nearby: { mobs: [mob] } };
    const there = roughPositionOf(data(patch), mob);
    expect(selfCaused(data(patch), ws([], { skill: "attack", target: "entity:5" }, patch), there, "entity:5")).toBe(true);
    expect(selfCaused(data(patch), ws([{ skill: "hit", target: "entity:5", msAgo: 800 }], null, patch), there)).toBe(true);
    // A bang 30 blocks the other way while fighting is not the bot's doing.
    expect(selfCaused(data(patch), ws([], { skill: "attack", target: "entity:5" }, patch), { x: -30, y: 63, z: 0 })).toBe(false);
  });

  it("unsure counts as not self-caused", () => {
    expect(selfCaused(data(), ws([]), at)).toBe(false);
    expect(selfCaused(data(), ws([{ skill: "go_to", target: "pos:3,63,0", msAgo: 500 }]), at)).toBe(false);
    expect(selfCaused(data(), ws([{ skill: "break_block", changes: { targetAt: "3,63,0" }, msAgo: 500 }]), null)).toBe(false);
  });
});

describe("startleSurroundings", () => {
  it("gives how dark it is and whether the place is remembered as bad, as numbers", () => {
    expect(startleSurroundings(fakeState())).toEqual({ dark: 0, badPlace: 0 });
    expect(startleSurroundings(fakeState({ time: { lightLevel: 0 } }))).toEqual({ dark: 1, badPlace: 0 });
    const bad = fakeState();
    (bad.data as { memory: unknown }).memory = { nearby: "bad", kind: "danger" };
    expect(startleSurroundings(bad)).toEqual({ dark: 0, badPlace: 1 });
  });
});
