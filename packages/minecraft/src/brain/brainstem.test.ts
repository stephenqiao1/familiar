import type { Skill } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { describe, expect, it } from "vitest";
import { fakeData, fakeState, type StatePatch } from "../encode/state.test-helper.js";
import { menuSkills } from "../skills/index.js";
import { startled } from "./alarm.js";
import { drowsy, HOLDABLE, hostileUpClose, hurtUnseen, leaningOf, loudNearby, playerBrainstem, REFLEX_NOTE, somethingNew } from "./brainstem.js";

const ws = createWorkspace().viewFor("brainstem");
const zombie = (dist: number, id = 1) => ({ id: `entity:${id}`, type: "zombie", dist, hostile: true, reachable: true });
const moment = (before: StatePatch, after: StatePatch) => ({ before: fakeState(before), after: fakeState(after), ws });

describe("player startle detectors", () => {
  it("hostile up close: a hostile first seen within 3 blocks", () => {
    expect(hostileUpClose.check(moment({}, { nearby: { mobs: [zombie(2)] } }))).toEqual({ source: { id: "entity:1", kind: "zombie" } });
    expect(hostileUpClose.check(moment({}, { nearby: { mobs: [zombie(5)] } }))).toBeNull();
    // Seen coming: no startle when it arrives.
    expect(hostileUpClose.check(moment({ nearby: { mobs: [zombie(12)] } }, { nearby: { mobs: [zombie(2)] } }))).toBeNull();
  });

  it("hurt unseen: hit by something while no threat was in view", () => {
    const hit = { self: { lastHurt: { msAgo: 10, by: "entity:9", kind: "mob_attack", at: { x: 0, y: 63, z: 0 } } } };
    expect(hurtUnseen.check(moment({}, hit))).toEqual({ source: null });
    expect(hurtUnseen.check(moment({}, { ...hit, nearby: { mobs: [zombie(20, 9)] } }))).toEqual({ source: { id: "entity:9", kind: "zombie" } });
    // A threat was already in view: being hit is no surprise.
    expect(hurtUnseen.check(moment({ nearby: { mobs: [zombie(4)] } }, { ...hit, nearby: { mobs: [zombie(4)] } }))).toBeNull();
    // A fall, fire or hunger has no attacker, and an old hurt is not a new one.
    expect(hurtUnseen.check(moment({}, { self: { lastHurt: { msAgo: 10, by: null, kind: null, at: { x: 0, y: 63, z: 0 } } } }))).toBeNull();
    expect(hurtUnseen.check(moment({ self: { lastHurt: { msAgo: 100, by: "entity:9", kind: "mob_attack", at: { x: 0, y: 63, z: 0 } } } }, { self: { lastHurt: { msAgo: 600, by: "entity:9", kind: "mob_attack", at: { x: 0, y: 63, z: 0 } } } }))).toBeNull();
  });

  it("loud nearby: an explosion or thunder within 16 blocks", () => {
    expect(loudNearby.check(moment({}, { nearby: { loud: [{ type: "explosion", dist: 9 }] } }))).toEqual({ source: null });
    expect(loudNearby.check(moment({}, { nearby: { loud: [{ type: "explosion", dist: 30 }] } }))).toBeNull();
  });
});

describe("somethingNew (orienting)", () => {
  it("is whoever just hurt the bot, else a hostile or player that has just come into view", () => {
    const data = (p: StatePatch) => fakeData(p);
    expect(somethingNew(data({}), data({ nearby: { mobs: [zombie(12)] } }))).toEqual({ id: "entity:1", kind: "zombie" });
    expect(somethingNew(data({}), data({ nearby: { players: [{ id: "entity:4", type: "player", dist: 9 }] } }))).toEqual({ id: "entity:4", kind: "player" });
    expect(somethingNew(data({ nearby: { mobs: [zombie(12)] } }), data({ nearby: { mobs: [zombie(11)] } }))).toBeNull();
    expect(somethingNew(data({}), data({ nearby: { mobs: [{ ...zombie(5), hostile: false, type: "cow" }] } }))).toBeNull();
    const hurtBy = data({ self: { lastHurt: { msAgo: 5, by: "entity:2", kind: "mob_attack", at: { x: 0, y: 63, z: 0 } } }, nearby: { mobs: [zombie(12), zombie(14, 2)] } });
    expect(somethingNew(data({ nearby: { mobs: [zombie(12), zombie(14, 2)] } }), hurtBy)).toEqual({ id: "entity:2", kind: "zombie" });
  });
});

describe("the startle alarm trigger", () => {
  it("adds to alarm on the tick the brainstem is startled", () => {
    const store = createWorkspace();
    const check = () => startled.check({ before: fakeState(), after: fakeState(), ws: store.viewFor("noradrenaline") });
    expect(check()).toBe(0);
    store.viewFor("brainstem").setSignal("startle", 1);
    expect(check()).toBe(0.3);
    store.viewFor("brainstem").setSignal("startle", 0);
    expect(check()).toBe(0);
  });
});

describe("playerBrainstem", () => {
  const skill = (name: string, flags: Partial<Skill<null>> = {}): Skill<null> => ({ name, description: "", canRun: (_ctx, target) => target !== "pos:0,0,0", run: async () => ({ status: "done" }), ...flags });
  const skills = [skill("flee"), skill("brace", { primitive: true }), skill("surface", { reflexOnly: true })];
  const settings = playerBrainstem(skills, null);

  it("lets a loaded response name a real skill, but not a primitive, a reflex-only skill or an unknown one", () => {
    expect(settings.responseProblem("flee")).toBeNull();
    expect(settings.responseProblem("brace")).toBe("a primitive, not a skill");
    expect(settings.responseProblem("surface")).toBe("reflex-only skill");
    expect(settings.responseProblem("fly")).toBe("unknown skill");
  });

  it("reads the body: health, breath and hunger as 0 to 1", () => {
    expect(settings.body(fakeState({ self: { health: 10, air: 5, food: 15 } }))).toEqual({ health: 0.5, air: 0.75, hunger: 0.25, stuck: false, sore: 0 });
    expect(settings.body({ schemaVersion: 0, tick: 0, timestamp: 0, data: {} })).toBeNull();
  });

  it("is drowsy at night with nothing hostile in view and nothing to do", () => {
    const at = (p: StatePatch, running: string | null) => {
      const store = createWorkspace();
      store.update(fakeState(p), running ? { skill: running, target: undefined, startedAt: 0 } : null);
      return drowsy(store.viewFor("brainstem"));
    };
    expect(at({ time: { isNight: true } }, "idle")).toBe(true);
    expect(at({ time: { isNight: true } }, "go_to")).toBe(false);
    expect(at({ time: { isNight: false } }, null)).toBe(false);
    expect(at({ time: { isNight: true }, nearby: { mobs: [zombie(12)] } }, null)).toBe(false);
  });

  it("knows which way each reflex skill leans, and what a goal may hold back", () => {
    expect([leaningOf("flee"), leaningOf("attack"), leaningOf("eat")]).toEqual(["away", "toward", null]);
    expect(HOLDABLE).toEqual(["threat_contact", "threat_approaching", "hold_ground", "edge_guard", "eat_when_starving", "flee", "attack", "eat", "steady"]);
    expect(REFLEX_NOTE).toContain("in_lava_or_fire, drowning, last_stand");
  });

  it("keeps primitives and reflex-only skills off the menu unless primitives are asked for", () => {
    expect(menuSkills(skills).map((s) => s.name)).toEqual(["flee"]);
    expect(menuSkills(skills, true).map((s) => s.name)).toEqual(["flee", "brace"]);
  });
});
