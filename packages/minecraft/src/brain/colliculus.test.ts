import { createWorkspace } from "@familiar/core";
import { DEFAULT_COLLICULUS, FEATURES, salienceOf } from "@familiar/region-brainstem";
import { describe, expect, it } from "vitest";
import { fakeData, fakeState, inView } from "../encode/state.test-helper.js";
import { looming } from "./alarm.js";
import { createScan, featuresOf, perceptsOf, playerColliculus, type Physical } from "./colliculus.js";
import { loomingThreat, threatApproachingRule } from "./reflexes.js";

const still: Physical = { dist: 8, angle: 0, closing: 0, speed: 0, sudden: false, incoming: false, loudness: 0, touch: false };
const mob = (id: number, type: string, dist: number, over: Partial<ReturnType<typeof inView>> & { hostile?: boolean; speed?: number } = {}) => ({ id: `entity:${id}`, type, dist, hostile: false, reachable: true, ...inView(over), ...over });
const salience = (p: Partial<Physical>) => salienceOf(featuresOf({ ...still, ...p }), "sight", DEFAULT_COLLICULUS);

describe("featuresOf", () => {
  it("takes physical facts only: nothing in its input says what the thing is", () => {
    const identity = ["kind", "type", "name", "hostile", "friendly", "reachable", "id"];
    expect(Object.keys(still).filter((key) => identity.includes(key))).toEqual([]);
    expect(Object.keys(still).sort()).toEqual(["angle", "closing", "dist", "incoming", "loudness", "speed", "sudden", "touch"]);
    expect(Object.keys(featuresOf(still)).sort()).toEqual([...FEATURES].sort());
  });

  it("looming: none under 4 blocks a second, rising to full at 8; a projectile heading this way is full at once", () => {
    expect([3.9, 4, 6, 8, 12].map((closing) => featuresOf({ ...still, closing }).looming)).toEqual([0, 0.5, 0.75, 1, 1]);
    expect(featuresOf({ ...still, closing: -6 }).looming).toBe(0);
    expect(featuresOf({ ...still, incoming: true }).looming).toBe(1);
  });

  it("nearer counts more; movement counts more in the periphery", () => {
    expect([0, 8, 16, 30].map((dist) => featuresOf({ ...still, dist }).nearness)).toEqual([1, 0.5, 0, 0]);
    expect(featuresOf({ ...still, speed: 4, angle: 80 }).motion).toBe(1);
    expect(featuresOf({ ...still, speed: 4, angle: 10 }).motion).toBe(0.6);
    expect(featuresOf({ ...still, speed: 0.2, angle: 80 }).motion).toBe(0);
  });

  it("the looming thing beats the near still thing, and touch beats everything", () => {
    const nearStill = salience({ dist: 1 });
    const fastFar = salience({ dist: 15, closing: 8, speed: 8 });
    expect(fastFar).toBeGreaterThan(nearStill);
    expect(salience({ dist: 15, touch: true })).toBeGreaterThan(salience({ dist: 1, closing: 8, speed: 8, sudden: true, loudness: 1 }));
  });
});

describe("perceptsOf", () => {
  it("puts only what is seen on the map by sight, with the same features whatever kind it is", () => {
    const data = fakeData({ nearby: { mobs: [mob(1, "zombie", 6, { hostile: true }), mob(2, "cow", 6), mob(3, "zombie", 4, { seen: false, hostile: true })] } });
    const percepts = perceptsOf(data);
    expect(percepts.map((p) => p.id)).toEqual(["entity:1", "entity:2"]);
    expect(percepts[0]!.features).toEqual(percepts[1]!.features);
    expect(percepts[0]).toMatchObject({ kind: "zombie", via: "sight", bearing: "ahead" });
  });

  it("marks what just appeared, started moving or changed as sudden, and a projectile as looming", () => {
    const left = { side: "left" as const, angle: 70 };
    const data = fakeData({
      nearby: {
        mobs: [mob(1, "cow", 8), mob(2, "cow", 8)],
        sudden: [
          { id: "entity:1", what: "started_moving", bearing: left, dist: 8 },
          { id: "entity:9", what: "looming", bearing: left, dist: 12 },
          { id: "pos:3,63,3", what: "changed", bearing: left, dist: 4 },
        ],
      },
    });
    const byId = Object.fromEntries(perceptsOf(data).map((p) => [p.id, p]));
    expect(byId["entity:1"]).toMatchObject({ features: { suddenness: 1 }, fresh: true });
    expect(byId["entity:2"]).toMatchObject({ features: { suddenness: 0 }, fresh: false });
    expect(byId["entity:9"]).toMatchObject({ kind: "unknown", features: { looming: 1, suddenness: 0 }, bearing: "left" });
    expect(byId["pos:3,63,3"]).toMatchObject({ kind: "block", features: { suddenness: 1 } });
  });

  it("puts sounds on the map where they came from; a sound is sudden only when it is new", () => {
    const heard = [{ type: "explosion", bearing: { side: "behind" as const, angle: 180 }, dist: 9, position: { x: 0, y: 63, z: 9 }, loudness: 0.75 }];
    const data = fakeData({ nearby: { heard } });
    expect(perceptsOf(data)).toMatchObject([{ id: "pos:0,63,9", kind: "explosion", via: "sound", bearing: "behind", features: { loudness: 0.75, suddenness: 1 } }]);
    expect(perceptsOf(data, () => false)[0]!.features.suddenness).toBe(0);
  });

  it("touch: whoever just hurt the bot, or where a push came from", () => {
    const hurt = fakeData({ self: { lastHurt: { msAgo: 100, by: "entity:1", kind: "mob_attack", at: { x: 0, y: 63, z: 0 } } }, nearby: { mobs: [mob(1, "zombie", 2, { seen: false, hostile: true, bearing: { side: "behind", angle: 180 } })] } });
    expect(perceptsOf(hurt)).toMatchObject([{ id: "entity:1", kind: "zombie", via: "touch", bearing: "behind", features: { touch: 1 } }]);
    const old = fakeData({ self: { lastHurt: { msAgo: 5000, by: "entity:1", kind: "mob_attack", at: { x: 0, y: 63, z: 0 } } } });
    expect(perceptsOf(old)).toEqual([]);
    const pushed = fakeData({ self: { pushed: { blocks: 1, toward: { x: 0, z: -1 }, danger: null } } });
    expect(perceptsOf(pushed)).toMatchObject([{ id: "pos:0,64,2", via: "touch" }]);
  });
});

describe("playerColliculus", () => {
  const skills = [
    { name: "idle", description: "", parts: [], canRun: () => true, run: async () => ({ status: "done" as const }) },
    { name: "attack", description: "", demanding: true, canRun: () => true, run: async () => ({ status: "done" as const }) },
    { name: "eat", description: "", parts: ["hands" as const], canRun: () => true, run: async () => ({ status: "done" as const }) },
    { name: "withdraw", description: "", reflexOnly: true, canRun: () => true, run: async () => ({ status: "done" as const }) },
  ];
  const ws = (running: string | null, patch: Parameters<typeof fakeState>[0] = {}, at = 1000) => {
    const store = createWorkspace();
    store.update(fakeState(patch, at), running ? { skill: running, target: undefined, startedAt: 0 } : null);
    return store.viewFor("colliculus");
  };

  it("knows a demanding skill and a reflex's skill; looks run beside idling always, and beside a head-free skill with the flag", () => {
    const plain = playerColliculus(skills);
    expect([plain.busy!(ws("attack")), plain.busy!(ws("withdraw")), plain.busy!(ws("eat")), plain.busy!(ws(null))]).toEqual(["demanding", "reflex", null, null]);
    expect([plain.looksAlongside!(ws("idle")), plain.looksAlongside!(ws("eat")), plain.looksAlongside!(ws(null))]).toEqual([true, false, false]);
    expect(playerColliculus(skills, true).looksAlongside!(ws("eat"))).toBe(true);
    expect([plain.idle(ws(null)), plain.idle(ws("idle")), plain.idle(ws("eat"))]).toEqual([true, true, false]);
  });

  it("a sound is new once: the tick after, the same sound is no longer sudden", () => {
    const c = playerColliculus(skills);
    const heard = [{ type: "explosion", bearing: { side: "behind" as const, angle: 180 }, dist: 9, position: { x: 0, y: 63, z: 9 }, loudness: 0.75 }];
    expect(c.percepts(ws(null, { nearby: { heard } }))[0]!.features.suddenness).toBe(1);
    expect(c.percepts(ws(null, { nearby: { heard } }))[0]!.features.suddenness).toBe(0);
  });

  it("does not glance around while travelling: the head looks where the body is going", () => {
    const c = playerColliculus(skills);
    expect(c.scan!(ws(null, { self: { locomotion: { moving: true, pattern: "walk", gait: "walk", stuck: false } } }))).toBeNull();
    expect(c.scan!(ws(null))).toMatch(/^pos:/);
  });
});

describe("createScan", () => {
  it("glances toward the direction looked at longest ago, so things behind get seen", () => {
    const scan = createScan();
    const facing = (yaw: number) => fakeData({ self: { gaze: { id: null, yaw } } });
    // Facing north (yaw 0): the first glance is not north, and eight glances cover every direction but the one faced.
    const targets = Array.from({ length: 7 }, (_, i) => scan(facing(0), 1000 * (i + 1)));
    expect(new Set(targets).size).toBe(7);
    expect(targets).not.toContain("pos:0,64,-8");
    expect(targets).toContain("pos:0,64,8"); // straight behind
  });
});

describe("looming in the defence reflexes and in alarm", () => {
  const arrow = { id: "entity:9", what: "looming" as const, bearing: { side: "ahead" as const, angle: 0 }, dist: 12 };
  const check = (rule: ReturnType<typeof threatApproachingRule>, patch: Parameters<typeof fakeState>[0]) => {
    const store = createWorkspace();
    store.update(fakeState(patch), null);
    return rule.check(store.viewFor("reflex"));
  };

  it("something looming makes a far hostile count as approaching, with no list of which mobs shoot", () => {
    const skeleton = mob(1, "skeleton", 14, { hostile: true });
    expect(check(threatApproachingRule(true), { nearby: { mobs: [skeleton] } })).toBeNull();
    expect(check(threatApproachingRule(true), { nearby: { mobs: [skeleton], sudden: [arrow] } })).toMatchObject({ action: { skill: "flee", target: "entity:1" }, urgency: 0.7, reason: "something coming fast, skeleton 14 blocks away" });
    expect(check(threatApproachingRule(false), { nearby: { mobs: [skeleton], sudden: [arrow] } })).toBeNull();
  });

  it("a creature that is itself coming fast is the thing to get away from, at any distance", () => {
    const charging = { ...mob(2, "ravager", 15, { hostile: true }), closing: 7 };
    const data = fakeData({ nearby: { mobs: [charging], sudden: [{ ...arrow, id: "entity:2", dist: 15 }] } });
    expect(loomingThreat(data)).toEqual({ id: "entity:2", what: "ravager coming fast" });
    // A projectile with nothing hostile in sight: nothing to run from.
    expect(loomingThreat(fakeData({ nearby: { sudden: [arrow] } }))).toBeNull();
  });

  it("looming raises alarm once, as it starts", () => {
    const trigger = looming();
    const store = createWorkspace();
    const ws = store.viewFor("noradrenaline");
    const moment = { before: fakeState(), after: fakeState(), ws };
    expect(trigger.check(moment)).toBe(0);
    store.viewFor("colliculus").setSignal("looming", 1);
    expect(trigger.check(moment)).toBe(0.6);
    expect(trigger.check(moment)).toBe(0);
    store.viewFor("colliculus").setSignal("looming", 0);
    trigger.check(moment);
    store.viewFor("colliculus").setSignal("looming", 0.5);
    expect(trigger.check(moment)).toBe(0.3);
  });
});
