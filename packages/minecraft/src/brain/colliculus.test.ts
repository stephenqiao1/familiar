import { createWorkspace } from "@familiar/core";
import { DEFAULT_COLLICULUS, FEATURES, salienceOf } from "@familiar/region-brainstem";
import { describe, expect, it } from "vitest";
import { fakeData, fakeState, inView } from "../encode/state.test-helper.js";
import { createScan, featuresOf, perceptsOf, playerColliculus, type Physical } from "./colliculus.js";
import { defenceReflexes } from "./defence.js";
import { withCloserLook } from "./instinct.js";

const still: Physical = { dist: 8, angle: 0, elevation: 0, size: 0, closing: 0, speed: 0, sudden: false, incoming: false, loudness: 0, touch: false };
const mob = (id: number, type: string, dist: number, over: Partial<ReturnType<typeof inView>> & { hostile?: boolean; speed?: number } = {}) => ({ id: `entity:${id}`, type, dist, hostile: false, reachable: true, ...inView(over), ...over });
const salience = (p: Partial<Physical>) => salienceOf(featuresOf({ ...still, ...p }), "sight", DEFAULT_COLLICULUS);

describe("featuresOf", () => {
  it("takes physical facts only: nothing in its input says what the thing is", () => {
    const identity = ["kind", "type", "name", "hostile", "friendly", "reachable", "id"];
    expect(Object.keys(still).filter((key) => identity.includes(key))).toEqual([]);
    expect(Object.keys(still).sort()).toEqual(["angle", "closing", "dist", "elevation", "incoming", "loudness", "size", "speed", "sudden", "touch"]);
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
  const flee = defenceReflexes().find((r) => r.name === "defence_flee")!;
  const check = (patch: Parameters<typeof fakeState>[0]) => {
    const store = createWorkspace();
    store.update(fakeState(patch), null);
    return flee.check(store.viewFor("reflex"));
  };

  it("something looming makes a far hostile count as coming, with no list of which mobs shoot", () => {
    const skeleton = mob(1, "skeleton", 14, { hostile: true });
    expect(check({ nearby: { mobs: [skeleton] } })).toBeNull();
    expect(check({ nearby: { mobs: [skeleton], sudden: [arrow] } })).toMatchObject({ action: { skill: "flee", target: "entity:1" }, urgency: 0.7 });
  });

  it("a creature that is itself coming fast is the thing to get away from, at any distance", () => {
    const charging = { ...mob(2, "ravager", 15, { hostile: true }), closing: 7 };
    expect(check({ nearby: { mobs: [charging], sudden: [{ ...arrow, id: "entity:2", dist: 15 }] } })).toMatchObject({ action: { skill: "flee", target: "entity:2" } });
    // A projectile with nothing hostile in sight: nothing to run from.
    expect(check({ nearby: { sudden: [arrow] } })).toBeNull();
  });
});

describe("up and down", () => {
  it("a seen thing carries its angle, elevation, light and the plain facts the lean goes by", () => {
    const bat = { ...mob(4, "bat", 10, { bearing: { side: "left", angle: 40 } }), elevation: 50, height: 0.9, light: 3, speed: 5 };
    const [p] = perceptsOf(fakeData({ nearby: { mobs: [bat] } }));
    expect(p).toMatchObject({ id: "entity:4", angle: 40, elevation: 50, light: 0.2, shape: { dist: 10, across: 5, closing: 0, height: 0.9 } });
    // Nothing in the facts says what it is.
    expect(Object.keys(p!.shape!).sort()).toEqual(["across", "closing", "dist", "height", "size"]);
  });

  it("something looming that is on no list carries its elevation; a block the bot itself changed is marked as its own doing", () => {
    const arrow = { id: "entity:9", what: "looming" as const, bearing: { side: "ahead" as const, angle: 0 }, dist: 12, elevation: 35 };
    const dug = { id: "pos:1,64,2", what: "changed" as const, bearing: { side: "ahead" as const, angle: 0 }, dist: 2 };
    const percepts = perceptsOf(fakeData({ nearby: { sudden: [arrow, dug] } }), () => true, (id) => id === "pos:1,64,2");
    expect(percepts[0]).toMatchObject({ id: "entity:9", elevation: 35 });
    expect(percepts[0]!.own).toBeUndefined();
    expect(percepts[1]).toMatchObject({ id: "pos:1,64,2", own: true });
  });

  it("glances cover up and down: the sky outdoors, the ceiling and the floor under a roof; never with elevation at 0", () => {
    const heights = (skyLight: number, upDown: number) => {
      const scan = createScan();
      return Array.from({ length: 16 }, (_, i) => Number(scan(fakeData({ self: { skyLight, gaze: { id: null, yaw: 0 } } }), 1000 * (i + 1), upDown).split(",")[1]));
    };
    const eye = 64; // the fake bot stands at y 63
    expect(new Set(heights(15, 0))).toEqual(new Set([eye]));
    expect(heights(15, 1).filter((y) => y > eye).length).toBe(4);
    expect(heights(15, 1).filter((y) => y < eye).length).toBe(0);
    const under = heights(0, 1);
    expect(under.filter((y) => y > eye).length).toBe(2);
    expect(under.filter((y) => y < eye).length).toBe(2);
    // One glance at a time: every call names one place.
    expect(under.every(Number.isFinite)).toBe(true);
  });
});

describe("the lean, as the defence circuit and instinct take it", () => {
  const rules = defenceReflexes({ recuperate: 1, lean: 1 });
  const rule = (name: string) => rules.find((r) => r.name === name)!;
  const check = (name: string, patch: Parameters<typeof fakeState>[0], lean: "avoid" | "freeze" | "approach" | undefined, reflexes = rules) => {
    const store = createWorkspace();
    store.update(fakeState(patch), null);
    if (lean) store.viewFor("colliculus").setAttended({ id: "entity:7", kind: "phantom", bearing: "ahead", salience: 1, since: 0, field: "upper", lean });
    return reflexes.find((r) => r.name === name)!.check(store.viewFor("reflex"));
  };
  const diving = { ...mob(7, "phantom", 12, { hostile: true }), closing: 7 };
  const looming = { id: "entity:7", what: "looming" as const, bearing: { side: "ahead" as const, angle: 0 }, dist: 12 };

  it("fleeing from something diving from above goes for cover; with no lean, or the lean ignored, it runs as before", () => {
    const patch = { nearby: { mobs: [diving], sudden: [looming] } };
    expect(check("defence_flee", patch, "avoid")).toMatchObject({ action: { skill: "take_cover", target: "entity:7" }, urgency: 0.7 });
    expect(check("defence_flee", patch, undefined)).toMatchObject({ action: { skill: "flee", target: "entity:7" }, urgency: 0.7 });
    expect(check("defence_flee", patch, "avoid", defenceReflexes())).toMatchObject({ action: { skill: "flee" } });
    expect(rule("defence_flee")).toBeDefined();
  });

  it("a lean never overrides a threat that is on the bot", () => {
    const onIt = { nearby: { mobs: [{ ...mob(7, "phantom", 2, { hostile: true }) }] } };
    const flee = check("defence_flee", onIt, "avoid");
    const fight = check("defence_fight", onIt, "avoid");
    expect([flee, fight].filter(Boolean).map((p) => (p!.action as { skill: string }).skill)).not.toContain("take_cover");
    expect(check("defence_freeze", onIt, "freeze")).toBeNull();
  });

  it("something crossing overhead with nothing coming: hold still and watch; never while something is coming", () => {
    expect(check("defence_freeze", {}, "freeze")).toMatchObject({ action: { skill: "hold_still", target: "entity:7" }, urgency: 0.5 });
    expect(check("defence_freeze", {}, undefined)).toBeNull();
    expect(check("defence_freeze", {}, "freeze", defenceReflexes())).toBeNull();
    expect(check("defence_freeze", { nearby: { mobs: [diving], sudden: [looming] } }, "freeze")).toBeNull();
  });

  it("a thing worth a closer look is one line in what Jev is told", () => {
    const store = createWorkspace();
    store.update(fakeState({}), null);
    expect(withCloserLook("context", store.viewFor("instinct"))).toBe("context");
    store.viewFor("colliculus").setAttended({ id: "entity:3", kind: "rabbit", bearing: "left", salience: 0.7, since: 0, lean: "approach" });
    const told = withCloserLook("context", store.viewFor("instinct"));
    expect(told.split("\n")).toHaveLength(2);
    expect(told).toContain("rabbit");
  });
});
