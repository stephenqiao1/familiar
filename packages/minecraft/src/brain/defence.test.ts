import { describe, expect, it } from "vitest";
import type { State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { RECOVERING_SIGNAL } from "@familiar/region-brainstem";
import type { ReflexRule } from "@familiar/region-reflex";
import { assessDefence } from "../defence/assess.js";
import type { ThreatFacts } from "../defence/size-up.js";
import { SCHEMA_VERSION } from "../encode/encode-state.js";
import type { MinecraftStateData } from "../encode/state-data.js";
import { fakeData } from "../encode/state.test-helper.js";
import { hostileAppeared, threatPresent } from "./alarm.js";
import { DEFENCE_REFLEXES, defenceOf, defenceReflexes, pressingThreat, threatLevel } from "./defence.js";
import { lastStand, playerReflexes } from "./reflexes.js";

type Mob = MinecraftStateData["nearby"]["mobs"][number];

/** A bot carrying a sword; `mobs` as a bare state gives them (no threat sense). */
function data(over: { self?: Partial<MinecraftStateData["self"]>; mobs?: Mob[]; lightLevel?: number } = {}): MinecraftStateData {
  const self = { heldItem: "stone_sword", bestWeapon: "stone_sword", inventory: { stone_sword: 1 } };
  return fakeData({ self: { ...self, ...over.self }, nearby: { mobs: over.mobs ?? [] }, ...(over.lightLevel === undefined ? {} : { time: { isNight: true, lightLevel: over.lightLevel } }) });
}
const stateOf = (d: MinecraftStateData, timestamp = 0): State => ({ schemaVersion: SCHEMA_VERSION, tick: 0, timestamp, data: { ...d } });
function workspace(d: MinecraftStateData) {
  const store = createWorkspace();
  store.update(stateOf(d), null);
  return store;
}
const zombie: Mob = { id: "entity:7", type: "zombie", dist: 6, hostile: true, reachable: true };
/** Every defence proposal the reflexes make for a state. */
const defences = (d: MinecraftStateData, rules: ReflexRule[] = playerReflexes) =>
  rules.filter((r) => DEFENCE_REFLEXES.includes(r.name)).flatMap((r) => { const p = r.check(workspace(d).viewFor("reflex")); return p ? [{ rule: r.name, ...p }] : []; });
/** A state as the threat sense would make it. */
const sensed = (facts: Partial<ThreatFacts>, self: Partial<MinecraftStateData["self"]> = {}): MinecraftStateData => {
  const d = data({ self, mobs: [{ ...zombie, dist: facts.dist ?? 6 }] });
  const full: ThreatFacts = { id: "entity:7", kind: "zombie", dist: 6, seen: true, approach: 2, looming: false, facing: false, hurtMsAgo: null, canWalkTo: true, clearLine: true, shoots: false, escapable: true, danger: 0.5, beatable: true, ...facts };
  return { ...d, defence: assessDefence(d, [full]) };
};

describe("the defence reflexes from a bare state (the cheap rules)", () => {
  it("coming (noticed, inside 8 blocks): flees, even when armed and healthy", () => {
    expect(defences(data({ mobs: [zombie] }))).toMatchObject([{ rule: "defence_flee", action: { skill: "flee", target: "entity:7" }, urgency: 0.7 }]);
  });
  it("on it (3 blocks or less): fights when armed and healthy, breaks away otherwise", () => {
    const close = { ...zombie, dist: 2 };
    expect(defences(data({ mobs: [close] }))).toMatchObject([{ rule: "defence_fight", action: { skill: "attack", target: "entity:7" }, urgency: 0.9 }]);
    expect(defences(data({ self: { health: 8 }, mobs: [close] }))).toMatchObject([{ rule: "defence_flee", urgency: 0.9 }]);
    expect(defences(data({ self: { bestWeapon: null }, mobs: [close] }))).toMatchObject([{ rule: "defence_flee", urgency: 0.9 }]);
    // Only one defence speaks, for the most pressing threat.
    expect(defences(data({ mobs: [close, zombie] }))).toHaveLength(1);
  });
  it("creepers and the kinds that hit from afar: never fought by reflex", () => {
    for (const type of ["creeper", "skeleton", "witch"]) expect(defences(data({ mobs: [{ ...zombie, type, dist: 2 }] }))).toMatchObject([{ rule: "defence_flee" }]);
  });
  it("in view and unaware (it is not closing): freezes, watching it", () => {
    expect(defences(data({ mobs: [{ ...zombie, dist: 10, seen: true, closing: 0, bearing: { side: "ahead", angle: 0 } }] }))).toMatchObject([{ rule: "defence_freeze", action: { skill: "freeze", target: "entity:7" }, urgency: 0.5 }]);
  });
  it("far off, unable to reach the bot, or friendly: no defence at all", () => {
    for (const mob of [{ ...zombie, dist: 12 }, { ...zombie, dist: 5, reachable: false }, { ...zombie, dist: 2, reachable: false }, { ...zombie, dist: 2, hostile: false }]) {
      expect(defences(data({ mobs: [mob] }))).toEqual([]);
    }
    expect(playerReflexes.flatMap((r) => r.check(createWorkspace().viewFor("r")) ?? [])).toEqual([]);
  });
  it("shares how pressing it is: 0 none, 0.3 possible, 0.5 seen, 0.8 coming, 1 on it", () => {
    expect(threatLevel(stateOf(data()))).toBe(0);
    expect(threatLevel(stateOf(data({ lightLevel: 2 })))).toBe(0.3);
    expect(threatLevel(stateOf(data({ mobs: [{ ...zombie, dist: 12 }] })))).toBe(0.5);
    expect(threatLevel(stateOf(data({ mobs: [zombie] })))).toBe(0.8);
    expect(threatLevel(stateOf(data({ mobs: [{ ...zombie, dist: 2 }] })))).toBe(1);
  });
});

describe("the defence reflexes from the threat sense's reading", () => {
  it("uses the state's own reading when it has one", () => {
    const d = sensed({ dist: 6, escapable: false });
    expect(defenceOf(d)).toBe(d.defence);
    expect(defences(d)).toMatchObject([{ rule: "defence_freeze", urgency: 0.6 }]);
  });
  it("cornered with it on the bot: fights, unarmed and nearly dead too", () => {
    expect(defences(sensed({ dist: 2, escapable: false }, { bestWeapon: null, health: 4 }))).toMatchObject([{ rule: "defence_fight", action: { skill: "attack" } }]);
  });
  it("a freeze ends the tick the threat notices and closes", () => {
    expect(defences(sensed({ dist: 7, approach: 0 }))).toMatchObject([{ rule: "defence_freeze" }]);
    expect(defences(sensed({ dist: 7, approach: 2 }))).toMatchObject([{ rule: "defence_flee" }]);
  });
});

describe("last_stand", () => {
  it("breaks away when there is a way out, and stays silent when cornered (the defence circuit fights instead)", () => {
    const view = (d: MinecraftStateData) => lastStand.check(workspace(d).viewFor("reflex"));
    expect(view(sensed({ dist: 2 }, { health: 5 }))).toMatchObject({ action: { skill: "flee", target: "entity:7" } });
    const cornered = sensed({ dist: 2, escapable: false }, { health: 5 });
    expect(view(cornered)).toBeNull();
    expect(defences(cornered)).toMatchObject([{ rule: "defence_fight" }]);
  });
  it("goes by the game's own hostile flag: it fires for a bot that has learned no threats at all", () => {
    const d = data({ self: { health: 5 }, mobs: [{ ...zombie, dist: 2 }] });
    const nothingLearned = { ...d, defence: assessDefence(d, []) };
    expect(defences(nothingLearned)).toEqual([]);
    expect(lastStand.check(workspace(nothingLearned).viewFor("reflex"))).toMatchObject({ action: { skill: "flee" } });
  });
});

describe("recuperate", () => {
  const rule = defenceReflexes().find((r) => r.name === "recuperate")!;
  const check = (d: MinecraftStateData, recovering: number) => {
    const ws = workspace(d).viewFor("reflex");
    ws.setSignal(RECOVERING_SIGNAL, recovering);
    return rule.check(ws);
  };
  it("fires while the body is recovering, hurt and clear", () => {
    expect(check(data({ self: { health: 8 } }), 1)).toMatchObject({ action: { skill: "recuperate" }, urgency: 0.4 });
    expect(check(data({ self: { health: 8 } }), 0)).toBeNull();
  });
  it("ends when a threat returns, or once mended", () => {
    expect(check(data({ self: { health: 8 }, mobs: [zombie] }), 1)).toBeNull();
    expect(check(data({ self: { health: 16 } }), 1)).toBeNull();
  });
  it("is left out with the strength at 0", () => {
    expect(defenceReflexes({ recuperate: 0 }).map((r) => r.name)).toEqual(["defence_fight", "defence_flee", "defence_freeze"]);
  });
});

describe("alarm agrees with defence", () => {
  it("a threat that cannot reach the bot does not hold alarm up; one that can does", () => {
    expect(threatPresent(stateOf(data({ mobs: [{ ...zombie, dist: 3, reachable: false }] })))).toBe(false);
    expect(pressingThreat(data({ mobs: [{ ...zombie, dist: 3, reachable: false }] }))).toBeNull();
    expect(threatPresent(stateOf(data({ mobs: [zombie] })))).toBe(true);
    expect(threatPresent(stateOf(sensed({ dist: 6, canWalkTo: false })))).toBe(false);
  });
  it("one that shoots and has a clear line holds alarm up from where it is", () => {
    expect(threatPresent(stateOf(sensed({ dist: 7, canWalkTo: false, shoots: true, facing: true, approach: 0 })))).toBe(true);
  });
  it("a threat that has not noticed the bot raises no alarm: it is frozen for, or routed round, calmly", () => {
    const unaware = { ...zombie, dist: 6, seen: true, closing: 0, bearing: { side: "ahead" as const, angle: 0 } };
    expect(threatPresent(stateOf(data({ mobs: [unaware] })))).toBe(false);
    expect(threatPresent(stateOf(data({ mobs: [{ ...unaware, closing: 2 }] })))).toBe(true);
  });
  it("hostile_appeared fires for a threat that can reach the bot, not for one that cannot", () => {
    const appeared = (mob: Mob) => hostileAppeared().check({ before: stateOf(data()), after: stateOf(data({ mobs: [mob] }), 1000), ws: workspace(data()).viewFor("noradrenaline") });
    expect(appeared(zombie)).toBeGreaterThan(0.5);
    expect(appeared({ ...zombie, reachable: false })).toBe(0);
  });
});
