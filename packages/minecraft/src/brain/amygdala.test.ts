import type { Workspace } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { describe, expect, it } from "vitest";
import { fakeState, inView, type StatePatch } from "../encode/state.test-helper.js";
import { alikeKinds, createAlike, type KindFacts } from "./alike.js";
import { KNOWN_HARM } from "../defence/threat-record.js";
import { associationsFrom, moveOver } from "./amygdala-move.js";
import { createShadow } from "./amygdala-shadow.js";
import { playerCues, playerOutcomes, timeBand, type AmygdalaSenses } from "./amygdala.js";

const senses: AmygdalaSenses = { innateThreats: "game", innateHurts: ["cactus"], innateBadFoods: ["rotten_flesh"] };
const zombie = { id: "entity:1", type: "zombie", dist: 4, hostile: true, reachable: true, ...inView() };
const cow = { id: "entity:2", type: "cow", dist: 8, hostile: false, reachable: true, ...inView() };

function at(patch: StatePatch, timestamp = 0, set: (ws: Workspace) => void = () => {}): Workspace {
  const store = createWorkspace();
  store.update(fakeState(patch, timestamp), null);
  const ws = store.viewFor("test");
  set(ws);
  return ws;
}
const keys = (ws: Workspace, s = senses) => Object.fromEntries(playerCues(s)(ws).map((c) => [c.key, c]));

describe("the cues the amygdala is offered", () => {
  it("offers the kind of each thing in view, the one attended to most, and inborn fears as a start", () => {
    const cues = keys(at({ nearby: { mobs: [zombie, cow, { ...cow, id: "entity:3", type: "pig", ...inView({ seen: false }) }] } }, 0, (ws) => ws.setAttended({ id: "entity:1", kind: "zombie", bearing: "ahead", salience: 1, since: 0 })));
    expect(cues["kind:zombie"]).toMatchObject({ salience: 1, born: { harm: 0.5 } });
    expect(cues["kind:cow"]!.salience).toBeLessThan(1);
    expect(cues["kind:cow"]!.born).toBeUndefined();
    expect(cues["kind:pig"]).toBeUndefined();
  });

  it("offers the blocks touched, the place, the time of day and what is heard", () => {
    const ws = at({ time: { dayTick: 15_000, isNight: true }, self: { touching: { feet: "air", head: "air", below: "sand", sides: ["cactus", "air", "air", "air"] } }, nearby: { heard: [{ type: "explosion", bearing: { side: "ahead", angle: 0 }, dist: 5, position: { x: 0, y: 0, z: 5 }, loudness: 0.5, msAgo: 100 }] } }, 0, (w) => w.setPlace({ cell: "c", area: "a3", familiarity: 0.5 }));
    const cues = keys(ws);
    expect(Object.keys(cues).sort()).toEqual(["area:a3", "block:cactus", "block:sand", "sound:explosion", "time:night"]);
    expect(cues["block:cactus"]!.born).toEqual({ harm: 0.8 });
    expect(cues["sound:explosion"]!.salience).toBeCloseTo(0.3);
  });

  it("puts the day in four bands", () => {
    expect([1000, 12_500, 18_000, 23_000].map((dayTick) => timeBand({ isNight: false, lightLevel: 15, dayTick }))).toEqual(["day", "dusk", "night", "dawn"]);
  });

  it("offers a food just eaten, to be blamed for a minute and only through the gut; and signs", () => {
    const s: AmygdalaSenses = { ...senses, meal: () => ({ food: "rotten_flesh", at: 1000 }), signs: () => ["danger|creeper"], nameOf: () => "Alex" };
    const cues = keys(at({ nearby: { players: [{ id: "entity:9", type: "player", dist: 3, ...inView() }] } }, 2000), s);
    expect(cues["food:rotten_flesh"]).toMatchObject({ through: "gut", lingerMs: 60_000, born: { harm: 0.8 } });
    expect(cues["sign:danger|creeper"]).toBeDefined();
    expect(cues["kind:player:Alex"]).toBeDefined();
    expect(keys(at({}, 30_000), s)["food:rotten_flesh"]).toBeUndefined();
  });
});

describe("moving the older rules' learning over", () => {
  const counts = { seen: 5, hurts: 2, damage: 8, kills: 0, deaths: 0, badLosses: 0, rangedHurts: 0 };
  const old = { threats: { zombie: { ...counts, danger: 0.7 }, wolf: { ...counts, danger: 0.6, threat: true }, cow: { ...counts, hurts: 0, danger: 0.4 } }, hurts: { sweet_berry_bush: 2, gravel: 1 }, badFoods: { mystery_stew: 3 } };

  it("a threat (born or learned) predicts its recorded danger; a block or food known to the old rule, a fair harm; one only suspected, very little", () => {
    const moved = associationsFrom(old, { innateThreats: "game" }, (kind) => kind === "zombie", 1000);
    expect(moved).toMatchObject({ "kind:zombie": { harm: 0.7, sure: 1, at: 1000 }, "kind:wolf": { harm: 0.6 }, "block:sweet_berry_bush": { harm: 0.5 }, "food:mystery_stew": { harm: 0.5 } });
    expect(moved["kind:cow"]).toBeUndefined();
    expect(moved["block:gravel"]!.harm).toBeLessThan(KNOWN_HARM);
    expect(moved["block:sweet_berry_bush"]!.harm).toBeGreaterThanOrEqual(KNOWN_HARM);
  });

  it("is laid over what the amygdala already holds: the stronger harm stands, and what a cue was born with is kept", () => {
    const held = { "kind:zombie": { harm: 0.5, good: 0, sure: 1, at: 0, born: { harm: 0.5, good: 0 } }, "kind:wolf": { harm: 0.9, good: 0.1, sure: 1, at: 0 } };
    const out = moveOver(held, associationsFrom(old, { innateThreats: "game" }, (kind) => kind === "zombie", 1000));
    expect(out["kind:zombie"]).toMatchObject({ harm: 0.7, born: { harm: 0.5, good: 0 } });
    expect(out["kind:wolf"]).toMatchObject({ harm: 0.9, good: 0.1 });
  });
});

describe("what counts as an outcome", () => {
  const hurtBy = (by: string | null, kind = "mob_attack", msAgo = 0) => ({ msAgo, by, kind, at: { x: 0, y: 63, z: 0 } });
  const run = (ticks: [StatePatch, number, ((ws: Workspace) => void)?][], s = senses) => {
    const outcomes = playerOutcomes(s);
    return ticks.map(([patch, time, set]) => outcomes(at(patch, time, set)));
  };

  it("health lost is harm by its felt size (the root of the share lost), pointing at the attacker", () => {
    const out = run([[{ nearby: { mobs: [zombie] } }, 0], [{ self: { health: 14, lastHurt: hurtBy("entity:1") }, nearby: { mobs: [zombie] } }, 250]]);
    expect(out[1]).toEqual([{ sign: "harm", size: Math.sqrt(0.3), what: "lost 6 health to zombie", points: ["kind:zombie"] }]);
  });

  it("with no attacker it points at the block the game names", () => {
    const touching = { feet: "air", head: "air", below: "sand", sides: ["cactus", "air", "air", "air"] };
    const out = run([[{ self: { touching } }, 0], [{ self: { health: 19, touching, lastHurt: hurtBy(null, "cactus") } }, 250]]);
    expect(out[1]![0]).toMatchObject({ size: Math.sqrt(0.05), points: ["block:cactus"] });
  });

  it("a hurt of the body's own doing (a fall, hunger, drowning) is not an outcome, even when it kills", () => {
    expect(run([[{}, 0], [{ self: { health: 16, lastHurt: hurtBy(null, "fall") } }, 250]])[1]).toEqual([]);
    expect(run([[{}, 0], [{ self: { health: 20, deaths: 1, lastHurt: hurtBy(null, "starve") } }, 250]])[1]).toEqual([]);
  });

  it("a hurt that names no block being touched points at nothing; a creature that strikes unseen is still a cue", () => {
    const out = run([[{}, 0], [{ self: { health: 16, lastHurt: hurtBy(null, "generic") } }, 250]]);
    expect(out[1]![0]).toMatchObject({ size: Math.sqrt(0.2), points: [] });
    const behind = { ...zombie, ...inView({ seen: false }) };
    expect(keys(at({ nearby: { mobs: [behind] } }))["kind:zombie"]).toBeUndefined();
    expect(keys(at({ self: { lastHurt: hurtBy("entity:1") }, nearby: { mobs: [behind] } }))["kind:zombie"]!.salience).toBe(1);
  });

  it("death is harm in full, and final", () => {
    const out = run([[{}, 0], [{ self: { deaths: 1, health: 20 } }, 250]]);
    expect(out[1]![0]).toMatchObject({ sign: "harm", size: 1, final: true });
  });

  it("a first hit from a player is not an outcome; a second a little later is", () => {
    const s = { ...senses, nameOf: () => "Alex" };
    const players = [{ id: "entity:9", type: "player", dist: 2, ...inView() }];
    const out = run([[{ nearby: { players } }, 0], [{ self: { health: 18, lastHurt: hurtBy("entity:9", "player_attack") }, nearby: { players } }, 1000], [{ self: { health: 16, lastHurt: hurtBy("entity:9", "player_attack") }, nearby: { players } }, 4000]], s);
    expect(out[1]).toEqual([]);
    expect(out[2]![0]).toMatchObject({ points: ["kind:player:Alex"] });
  });

  it("a hurt the bot brought on itself is not an outcome", () => {
    const event = { skill: "break_block", event: "finished" as const, timestamp: 900, changes: { targetAt: "1,63,0" } };
    const store = createWorkspace();
    const outcomes = playerOutcomes(senses);
    store.update(fakeState({}, 0), null);
    outcomes(store.viewFor("t"));
    store.addEvent(event as never);
    store.update(fakeState({ self: { health: 17, lastHurt: { msAgo: 0, by: null, kind: "explosion", at: { x: 1, y: 63, z: 0 } } } }, 1000), null);
    expect(outcomes(store.viewFor("t"))).toEqual([]);
  });

  it("an illness starting is harm through the gut; a need dropping is good", () => {
    const hungry = (level: number) => (ws: Workspace) => ws.setNeeds({ readings: [{ name: "hunger", kind: "hunger", level, rank: 0, weight: 1, pressing: level }, { name: "safety", kind: "safety", level, rank: 1, weight: 1, pressing: level }] });
    const out = run([[{}, 0, hungry(0.6)], [{ self: { effects: ["poison"] } }, 250, hungry(0.2)]], { ...senses, sickness: (e) => (e === "poison" ? 1 : 0) });
    expect(out[1]).toEqual([{ sign: "harm", size: 0.5, what: "fell ill (poison)", through: "gut" }, { sign: "good", size: 0.4, what: "hunger eased by 0.4" }]);
  });
});

describe("how alike two kinds are", () => {
  const zombieFacts: KindFacts = { height: 1.95, width: 0.6, hostile: true, moves: "hostile", shoots: false };
  it("goes by size, movement, shooting and the game's hostile flag", () => {
    expect(alikeKinds(zombieFacts, { ...zombieFacts })).toBe(1);
    expect(alikeKinds(zombieFacts, { height: 1.4, width: 0.9, hostile: false, moves: "animal", shoots: false })).toBeLessThan(0.2);
    expect(alikeKinds(zombieFacts, { ...zombieFacts, shoots: true })).toBeCloseTo(0.7);
  });
  it("compares only kinds of creature with known facts", () => {
    const alike = createAlike((kind) => (kind === "zombie" || kind === "husk" ? zombieFacts : null));
    expect(alike("kind:zombie", "kind:husk")).toBe(1);
    expect(alike("kind:zombie", "kind:player:Alex")).toBe(0);
    expect(alike("block:cactus", "block:sand")).toBe(0);
  });
});

describe("the shadow report", () => {
  it("sets today's answers beside the amygdala's for whatever is around", () => {
    const old = { isThreat: (kind: string) => kind === "zombie", danger: () => 0.5, knowsHurt: (b: string) => b === "cactus", knowsBadFood: (f: string) => f === "rotten_flesh", isFood: (i: string) => i !== "stone" };
    const shadow = createShadow(old, (cue) => (cue === "kind:zombie" ? 0.62 : 0), {});
    const ws = at({ self: { inventory: { rotten_flesh: 1, stone: 3 }, touching: { feet: "air", head: "air", below: "sand", sides: ["cactus", "air", "air", "air"] } }, nearby: { mobs: [zombie, cow] } }, 0, (w) => w.setPlace({ cell: "c", area: "a1", familiarity: 1 }));
    expect(shadow(ws)).toEqual([
      ["kind", "kind:zombie", 0.5, 0.62],
      ["kind", "kind:cow", 0, 0],
      ["block", "block:sand", 0, 0],
      ["block", "block:cactus", 1, 0],
      ["food", "food:rotten_flesh", 1, 0],
      ["place", "area:a1", 0, 0],
    ]);
  });
});
