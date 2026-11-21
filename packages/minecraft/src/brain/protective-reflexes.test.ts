import { createWorkspace } from "@familiar/core";
import { createReflexGain, DEFAULT_BRAINSTEM } from "@familiar/region-brainstem";
import { createReflexRegion, type FiredReflex, type ReflexRule } from "@familiar/region-reflex";
import { describe, expect, it } from "vitest";
import { fakeState, type StatePatch } from "../encode/state.test-helper.js";
import { leaningOf } from "./brainstem.js";
import { aboutToTouch, buried, DEFAULT_REFLEXES, edgeGuard, fallingRight, holdGround, painWithdrawal, protectiveReflexes, reflexesProblem } from "./protective-reflexes.js";
import { createPlayerReflexes } from "./reflexes.js";

const signal = new AbortController().signal;
const HERE = { x: 0, y: 63, z: 0 };
const hurt = (kind: string | null, by: string | null = null, msAgo = 100) => ({ lastHurt: { msAgo, by, kind, at: HERE } });
const walking = { moving: true, pattern: "walk" as const, gait: "walk" as const, stuck: false };
const north = { x: 0, z: -1 };

/** What one rule proposes for a state. `running`: the skill under way. `signals`: what other regions shared. */
function check(rule: ReflexRule, self: StatePatch["self"] = {}, running: string | null = null, signals: Record<string, number> = {}) {
  const store = createWorkspace();
  store.update(fakeState({ self, current: running ? { skill: running, target: null, secondsRunning: 1 } : null }), null);
  for (const [name, value] of Object.entries(signals)) store.viewFor("brainstem").setSignal(name, value);
  return rule.check(store.viewFor("reflex"));
}

describe("pain_withdrawal", () => {
  it("fires when hurt with no attacker, whatever the thing was", () => {
    for (const kind of ["cactus", "hot_floor", "sweet_berry_bush", "freeze", null]) {
      expect(check(painWithdrawal, hurt(kind)), String(kind)).toMatchObject({ action: { skill: "withdraw" }, urgency: 1 });
    }
  });

  it("does not fire when hurt by a mob: that is for the defence reflexes", () => {
    expect(check(painWithdrawal, hurt("mob_attack", "entity:9"))).toBeNull();
  });

  it("does not fire for falling, drowning or starving (nothing to pull away from), or for lava and fire (their own reflex)", () => {
    for (const kind of ["fall", "drown", "starve", "lava", "in_fire", "on_fire", "in_wall"]) expect(check(painWithdrawal, hurt(kind)), kind).toBeNull();
  });

  it("only fires for a fresh hurt, and not once the bot is clear of the place", () => {
    expect(check(painWithdrawal, hurt("cactus", null, 600))).not.toBeNull();
    expect(check(painWithdrawal, hurt("cactus", null, 700))).toBeNull();
    expect(check(painWithdrawal, { ...hurt("cactus"), position: { x: 2, y: 63, z: 0 } })).toBeNull();
  });

  it("keeps firing while the withdrawal runs, so nothing takes over half way", () => {
    expect(check(painWithdrawal, hurt("cactus", null, 5000), "withdraw")).toMatchObject({ action: { skill: "withdraw" }, urgency: 1 });
  });
});

describe("buried", () => {
  it("fires when the head is inside a block", () => {
    expect(check(buried, { inBlock: true })).toMatchObject({ action: { skill: "dig_out" }, urgency: 1 });
    expect(check(buried, { inBlock: false })).toBeNull();
  });
});

describe("about_to_touch", () => {
  const toward = (what: string, blocks = 1) => ({ motion: { toward: north, danger: { what, blocks } } });

  it("fires when the next block in the direction of travel is lava, fire or a block known to hurt: stop and step back", () => {
    for (const what of ["lava", "fire", "cactus"]) {
      expect(check(aboutToTouch, toward(what)), what).toEqual({ action: { skill: "recoil", target: "pos:0.5,63,1.5" }, urgency: 1, reason: `${what} 1 block ahead` });
    }
  });

  it("does not fire on a planned journey: the route already allows for it", () => {
    expect(check(aboutToTouch, { ...toward("lava"), locomotion: walking })).toBeNull();
    // An urgent dash, or no journey at all, is not planned.
    expect(check(aboutToTouch, { ...toward("lava"), locomotion: { ...walking, pattern: "dash" } })).not.toBeNull();
  });

  it("fires when pushed toward it, too", () => {
    expect(check(aboutToTouch, { pushed: { blocks: 0.8, toward: north, danger: { what: "lava", blocks: 1 } } })).toMatchObject({ action: { skill: "recoil" } });
  });

  it("leaves a drop to the soft reflexes, and stays quiet with nothing ahead or while another reflex's skill runs", () => {
    expect(check(aboutToTouch, toward("drop"))).toBeNull();
    expect(check(aboutToTouch, { motion: { toward: north, danger: null } })).toBeNull();
    expect(check(aboutToTouch, toward("lava"), "escape_hazard")).toBeNull();
  });

  it("looks 1 block ahead normally, and 2 while sore", () => {
    expect(check(aboutToTouch, toward("lava", 2))).toBeNull();
    expect(check(aboutToTouch, toward("lava", 2), null, { sore: 0.4 })).toMatchObject({ action: { skill: "recoil" }, reason: "lava 2 blocks ahead" });
    expect(check(aboutToTouch, toward("lava", 2), null, { sore: 0 })).toBeNull();
  });
});

describe("hold_ground (the stretch reflex)", () => {
  const pushed = (what: string | null, blocks = 0.8) => ({ pushed: { blocks, toward: north, danger: what ? { what, blocks: 2 } : null } });
  const rule = holdGround(1);

  it("fires when a push is carrying the bot toward a drop, lava, fire or a block known to hurt: step back to where it stood", () => {
    expect(check(rule, pushed("drop"))).toEqual({ action: { skill: "steady", target: "pos:0.5,63,1.5" }, urgency: 0.8, reason: "pushed 0.8 blocks toward a drop" });
    expect(check(rule, pushed("cactus"))).toMatchObject({ action: { skill: "steady" }, reason: "pushed 0.8 blocks toward cactus" });
    expect(check(rule, pushed("drop", 2))?.action).toEqual({ skill: "steady", target: "pos:0.5,63,2.5" });
  });

  it("does not fire when the bot was moved somewhere else all at once (a teleport is not a push)", () => {
    expect(check(rule, { ...pushed("drop"), displaced: true })).toBeNull();
  });

  it("does nothing when pushed in the open, or when not pushed", () => {
    expect(check(rule, pushed(null))).toBeNull();
    expect(check(rule, {})).toBeNull();
  });

  it("is stronger while sore, and scaled by its strength", () => {
    expect(check(rule, pushed("drop"), null, { sore: 0.5 })?.urgency).toBe(0.9);
    expect(check(holdGround(0.5), pushed("drop"))?.urgency).toBe(0.4);
  });

  it("never fires while a hard reflex's skill is running", () => {
    for (const skill of ["escape_hazard", "surface", "withdraw", "dig_out", "recoil"]) expect(check(rule, pushed("drop"), skill), skill).toBeNull();
  });

  it("is scaled by the brainstem's gain (alarm raises it) and silenced by a goal that holds it back", async () => {
    const urgency = async (alarm: number, holdBack: string[] = []) => {
      const store = createWorkspace();
      store.update(fakeState({ self: pushed("drop") }), null);
      store.viewFor("noradrenaline").setSignal("alarm", alarm);
      if (holdBack.length) store.viewFor("prefrontal").setGoal({ text: "Drop down to the ledge below", steps: [], reason: "", holdBack });
      const gainOf = createReflexGain({ settings: DEFAULT_BRAINSTEM, alarmOf: (ws) => ws.signals.alarm?.value ?? 0, leaningOf });
      const out = await createReflexRegion({ rules: [rule], gainOf }).run(store.viewFor("reflex"), signal);
      return (out.trace?.rules as FiredReflex[])[0]!;
    };
    const [calm, alarmed] = [await urgency(0), await urgency(1)];
    expect(calm).toMatchObject({ kind: "soft", base: 0.8 });
    expect(calm.urgency).toBeCloseTo(0.48); // gain 0.6 when calm
    expect(alarmed.urgency).toBe(0.95); // gain 1.4, capped: a soft reflex never wins outright
    const held = await urgency(1, ["hold_ground"]);
    expect(held.urgency).toBeCloseTo(0.8 * 1.4 * 0.3);
    expect(held.urgency).toBeLessThan(calm.urgency);
  });
});

describe("edge_guard", () => {
  const rule = edgeGuard(1);
  const toward = (what: string, blocks = 1) => ({ motion: { toward: north, danger: { what, blocks } } });

  it("fires when stepping toward a drop one block ahead: stop and step back", () => {
    expect(check(rule, toward("drop"))).toEqual({ action: { skill: "steady", target: "pos:0.5,63,1.5" }, urgency: 0.6, reason: "a drop one block ahead" });
  });

  it("does not fire two blocks from the edge, on a planned journey, when pushed (hold_ground's job), or while a hard reflex's skill runs", () => {
    expect(check(rule, toward("drop", 2))).toBeNull();
    expect(check(rule, { ...toward("drop"), locomotion: walking })).toBeNull();
    expect(check(rule, { ...toward("drop"), pushed: { blocks: 0.8, toward: north, danger: { what: "drop", blocks: 1 } } })).toBeNull();
    expect(check(rule, toward("drop"), "withdraw")).toBeNull();
    expect(check(rule, toward("lava"))).toBeNull();
  });
});

describe("falling_right (the righting reflex)", () => {
  const falling = (steer: string | null, hurts = true) => ({ landing: { blocks: 8, onto: "stone", hurts, steer } });

  it("fires only when the landing would hurt and a better one is within reach", () => {
    expect(check(fallingRight, falling("pos:1,64,0"))).toEqual({ action: { skill: "air_steer", target: "pos:1,64,0" }, urgency: 1, reason: "falling 8 blocks onto stone: a better landing is in reach" });
    // Nothing better in reach: there is nothing a body can do.
    expect(check(fallingRight, falling(null))).toBeNull();
    // A landing that will not hurt needs no steering, and neither does standing on the ground.
    expect(check(fallingRight, falling(null, false))).toBeNull();
    expect(check(fallingRight, {})).toBeNull();
  });

  it("is hard, and keeps to the landing it chose until the body lands", () => {
    expect(fallingRight.kind).toBe("hard");
    const store = createWorkspace();
    store.update(fakeState({ self: falling("pos:2,64,0"), current: { skill: "air_steer", target: "pos:1,64,0", secondsRunning: 0 } }), null);
    expect(fallingRight.check(store.viewFor("reflex"))?.action).toEqual({ skill: "air_steer", target: "pos:1,64,0" });
    expect(check(fallingRight, {}, "air_steer")).toBeNull();
  });
});

describe("the protective reflexes as a set", () => {
  it("has four hard ones and two soft ones, each switched off by its setting", () => {
    const all = protectiveReflexes(DEFAULT_REFLEXES);
    expect([all.hard.map((r) => r.name), all.soft.map((r) => r.name)]).toEqual([["pain_withdrawal", "buried", "about_to_touch", "falling_right"], ["hold_ground", "edge_guard"]]);
    expect(all.hard.every((r) => r.kind === "hard") && all.soft.every((r) => r.kind === "soft")).toBe(true);
    const off = protectiveReflexes({ ...DEFAULT_REFLEXES, painWithdrawal: 0, buried: 0, aboutToTouch: 0, holdGround: 0, edgeGuard: 0 }, 0);
    expect([off.hard, off.soft]).toEqual([[], []]);
  });

  it("keeps in_lava_or_fire, drowning and last_stand first, exactly as they were", () => {
    expect(createPlayerReflexes().map((r) => r.name)).toEqual(["in_lava_or_fire", "drowning", "last_stand", "cornered_fight", "pain_withdrawal", "buried", "about_to_touch", "falling_right", "defence_fight", "defence_flee", "defence_freeze", "recuperate", "hold_ground", "edge_guard"]);
  });

  it("in_lava_or_fire reads the body, not the list: with nothing innate, lava still triggers it", () => {
    const reflexes = createPlayerReflexes({ ...DEFAULT_REFLEXES, innateHurts: [] });
    const inLava = reflexes.find((r) => r.name === "in_lava_or_fire")!;
    expect(check(inLava, { inLava: true })).toMatchObject({ action: { skill: "escape_hazard" } });
  });

  it("validates the settings: hard reflexes are 0 or 1, the rest 0 to 1", () => {
    expect(reflexesProblem(DEFAULT_REFLEXES)).toBeNull();
    expect(reflexesProblem({ ...DEFAULT_REFLEXES, buried: 0.5 })).toMatch(/reflexes.buried must be 0 or 1/);
    expect(reflexesProblem({ ...DEFAULT_REFLEXES, holdGround: 1.5 })).toMatch(/reflexes.holdGround must be 0 to 1/);
    expect(reflexesProblem({ ...DEFAULT_REFLEXES, edgeGuard: 0.5, innateHurts: [] })).toBeNull();
  });
});
