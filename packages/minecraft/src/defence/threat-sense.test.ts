import { EventEmitter } from "node:events";
import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { describe, expect, it } from "vitest";
import type { MinecraftStateData } from "../encode/state-data.js";
import { fakeData } from "../encode/state.test-helper.js";
import { createRouteChecks } from "./routes.js";
import { DEFAULT_DEFENCE, type DefenceSettings } from "./settings.js";
import { createThreatRecord } from "./threat-record.js";
import { createThreatSense } from "./threat-sense.js";

type Mob = MinecraftStateData["nearby"]["mobs"][number];
interface Creature { id: number; name: string; type: string; position: Vec3; yaw: number; height: number; isValid: boolean; username?: string }

/** A bot at the origin with some creatures around it; `tick` makes a state of them and sizes it up. */
function world(options: { settings?: Partial<DefenceSettings>; reach?: "yes" | "no"; escape?: "yes" | "no"; moving?: boolean } = {}) {
  const events = new EventEmitter();
  const entities: Record<number, Creature> = {};
  const attacked: number[] = [];
  const avoided: { name: string; radius: number }[] = [];
  const asked: string[] = [];
  const bot = {
    entity: { id: 0, position: new Vec3(0.5, 64, 0.5), height: 1.8 },
    entities,
    world: { raycast: () => null },
    attack: (e: Creature) => void attacked.push(e.id),
    on: (name: string, fn: (...args: unknown[]) => void) => events.on(name, fn),
  };
  const settings = { ...DEFAULT_DEFENCE, ...options.settings };
  const record = createThreatRecord(settings);
  const routes = createRouteChecks({
    reach: (id) => (asked.push(`reach:${id}`), () => options.reach ?? "yes"),
    escape: (id) => (asked.push(`escape:${id}`), () => options.escape ?? "yes"),
  });
  const logged: string[] = [];
  const sense = createThreatSense(bot as unknown as Bot, {
    settings,
    bravery: 0.5,
    record,
    routes,
    locomotion: { avoidArea: (name, _centre, radius) => void avoided.push({ name, radius }), status: () => ({ moving: options.moving ?? false, pattern: null, gait: "walk", stuck: false, progress: 0, recoveries: 0 }) },
    log: (msg) => logged.push(msg),
  });
  let now = 10_000;
  const add = (id: number, name: string, x: number, z = 0, type = "hostile"): Creature => (entities[id] = { id, name, type, position: new Vec3(x + 0.5, 64, z + 0.5), yaw: 0, height: 1.8, isValid: true });
  /** One state: every creature as the eyes would report it, plus the patch. */
  function tick(patch: { self?: Partial<MinecraftStateData["self"]>; ms?: number; sudden?: MinecraftStateData["nearby"]["sudden"] } = {}) {
    now += patch.ms ?? 500;
    const near = Object.values(entities).map((e) => ({ id: `entity:${e.id}`, type: e.type === "player" ? "player" : e.name, dist: Math.round(e.position.distanceTo(bot.entity.position)), seen: true, closing: 0, bearing: { side: "ahead" as const, angle: 0 } }));
    const mobs: Mob[] = near.filter((n) => n.type !== "player").map((n) => ({ ...n, hostile: entities[Number(n.id.slice(7))]!.type === "hostile", reachable: true }));
    const data = fakeData({ self: { deaths: 0, ...patch.self }, nearby: { mobs, players: near.filter((n) => n.type === "player"), sudden: patch.sudden ?? [] } });
    return sense.assess(data, now);
  }
  const hurtBy = (id: number, kind = "mob_attack") => ({ msAgo: 0, by: `entity:${id}`, kind, at: { x: 0, y: 64, z: 0 } });
  return { bot, events, entities, record, sense, tick, add, hurtBy, attacked, avoided, asked, logged };
}

describe("createThreatSense", () => {
  it("sizes up a threat that is not moving as seen and unaware, and one walking at the bot as coming", () => {
    const w = world();
    const zombie = w.add(1, "zombie", 7);
    w.tick();
    expect(w.tick().threats).toMatchObject([{ id: "entity:1", kind: "zombie", stage: "seen", noticed: false, danger: 0.5, flightDistance: 8 }]);
    zombie.position = new Vec3(5.5, 64, 0.5);
    const view = w.tick();
    expect(view.threats[0]).toMatchObject({ stage: "coming", noticed: true, noticedBy: "approach" });
    expect(view.choice).toMatchObject({ mode: "flee", target: "entity:1" });
  });

  it("the bot's own steps toward a threat are not the threat noticing it", () => {
    const w = world();
    w.add(1, "zombie", 7);
    w.tick();
    w.bot.entity.position = new Vec3(2.5, 64, 0.5);
    expect(w.tick().threats[0]).toMatchObject({ noticed: false });
  });

  it("a creature facing the bot for a second has noticed it", () => {
    const w = world();
    const zombie = w.add(1, "zombie", 6);
    // The bot is at -x from it: facing -x is yaw +90°.
    zombie.yaw = Math.PI / 2;
    w.tick();
    expect(w.tick().threats[0]).toMatchObject({ noticed: false });
    expect(w.tick({ ms: 800 }).threats[0]).toMatchObject({ noticed: true, noticedBy: "facing" });
  });

  it("ignores what is not a threat, until it hurts the bot", () => {
    const w = world();
    w.add(2, "wolf", 3, 0, "animal");
    w.tick();
    expect(w.tick().threats).toEqual([]);
    const after = w.tick({ self: { health: 16, lastHurt: w.hurtBy(2) } });
    expect(w.record.isThreat("wolf", false)).toBe(true);
    expect(after.learned).toContain("wolf became a threat (it hurt the bot)");
    expect(w.tick({ self: { health: 16, lastHurt: { ...w.hurtBy(2), msAgo: 500 } } }).threats).toMatchObject([{ kind: "wolf", stage: "on_it" }]);
  });

  it("learns that a kind shoots from two hurts from afar, and then counts it as able to reach with a clear line", () => {
    const w = world({ reach: "no" });
    w.add(3, "skeleton", 12);
    w.tick();
    expect(w.tick().threats[0]).toMatchObject({ canReach: false });
    w.tick({ self: { health: 17, lastHurt: w.hurtBy(3, "arrow") } });
    expect(w.record.shoots("skeleton")).toBe(false);
    const second = w.tick({ self: { health: 14, lastHurt: w.hurtBy(3, "arrow") }, ms: 3000 });
    expect(w.record.shoots("skeleton")).toBe(true);
    expect(second.learned).toEqual(expect.arrayContaining([expect.stringContaining("skeleton was found to shoot")]));
    expect(w.tick().threats[0]).toMatchObject({ canReach: true, shoots: true });
  });

  it("damage the game ties to no creature teaches nothing: a fall during a chase does not make the chaser shoot", () => {
    const w = world();
    w.add(1, "zombie", 10);
    w.tick();
    for (let i = 0; i < 3; i++) w.tick({ self: { health: 15 - i * 3, lastHurt: { msAgo: 0, by: null, kind: "fall", at: { x: 0, y: 64, z: 0 } } }, ms: 3000 });
    expect(w.record.shoots("zombie")).toBe(false);
    expect(w.record.danger("zombie")).toBe(0.5);
  });

  it("credits a kill to the bot when the creature dies just after the bot struck it", () => {
    const w = world();
    const zombie = w.add(1, "zombie", 2);
    w.tick();
    (w.bot as unknown as { attack(e: unknown): void }).attack(zombie);
    expect(w.attacked).toEqual([1]);
    w.events.emit("entityDead", zombie);
    expect(w.record.entries().zombie).toMatchObject({ kills: 1 });
    // A creature that dies without the bot having struck it is not the bot's kill.
    w.events.emit("entityDead", w.add(5, "zombie", 9));
    expect(w.record.entries().zombie).toMatchObject({ kills: 1 });
  });

  it("blames a death on whoever hurt the bot just before", () => {
    const w = world();
    w.add(1, "creeper", 3);
    w.tick();
    w.tick({ self: { health: 2, lastHurt: w.hurtBy(1, "explosion") } });
    w.tick({ self: { health: 20, deaths: 1, lastHurt: { ...w.hurtBy(1, "explosion"), msAgo: 600 } } });
    expect(w.record.entries().creeper).toMatchObject({ deaths: 1 });
    expect(w.record.danger("creeper")).toBeGreaterThan(0.7);
  });

  it("an encounter that ends with no harm lowers danger a little", () => {
    const w = world();
    w.add(1, "zombie", 12);
    w.tick();
    delete w.entities[1];
    w.tick();
    expect(w.record.danger("zombie")).toBeLessThan(0.5);
    expect(w.record.entries().zombie).toMatchObject({ seen: 1 });
  });

  it("asks the routes about the nearest two only, and a threat with no route to the bot cannot reach it", () => {
    const w = world({ reach: "no" });
    w.add(1, "zombie", 3);
    w.add(2, "zombie", 6);
    w.add(3, "zombie", 9);
    for (let i = 0; i < 4; i++) w.tick();
    const view = w.tick();
    expect(new Set(w.asked)).toEqual(new Set(["reach:1", "escape:1", "reach:2", "escape:2"]));
    expect(view.threats.map((t) => t.canReach)).toEqual([false, false, true]);
    expect(view.choice.mode).not.toBe("fight");
  });

  it("with no way out the bot is cornered: a threat on it is fought", () => {
    const w = world({ escape: "no" });
    w.add(1, "zombie", 2);
    w.tick();
    expect(w.tick({ self: { bestWeapon: null, health: 5 } }).choice).toMatchObject({ mode: "fight", cornered: true });
    // With the cornered part off, it always has a way out.
    const off = world({ escape: "no", settings: { cornered: 0 } });
    off.add(1, "zombie", 2);
    off.tick();
    expect(off.tick({ self: { bestWeapon: null } }).choice).toMatchObject({ mode: "flee", cornered: false });
  });

  it("while a journey is being planned the checks are skipped and the cheap guess stands", () => {
    const w = world({ reach: "no", moving: true });
    w.add(1, "zombie", 5);
    w.tick();
    w.tick();
    expect(w.asked).toEqual([]);
    expect(w.tick().threats[0]).toMatchObject({ canReach: true });
  });

  it("routes journeys round a threat that has not noticed, by its flight distance", () => {
    const w = world();
    w.add(1, "zombie", 10);
    w.tick();
    w.tick();
    expect(w.avoided.at(-1)).toEqual({ name: "entity:1", radius: 8 });
    const off = world({ settings: { avoid: 0 } });
    off.add(1, "zombie", 10);
    off.tick();
    expect(off.avoided).toEqual([]);
  });

  it("something looming with no creature of its own marks the nearest threat in view as coming", () => {
    const w = world();
    w.add(3, "skeleton", 14);
    w.tick();
    expect(w.tick({ sudden: [{ id: "entity:99", what: "looming", bearing: { side: "ahead", angle: 0 }, dist: 10 }] }).threats[0]).toMatchObject({ stage: "coming" });
  });

  it("flees a more dangerous kind to further off, and reports what sizing up cost", () => {
    const w = world();
    const zombie = w.add(1, "zombie", 5);
    expect(w.sense.safeDistance(zombie as never)).toBeCloseTo(16);
    w.record.diedTo("zombie");
    expect(w.sense.safeDistance(zombie as never)).toBeGreaterThanOrEqual(20);
    const view = w.tick();
    expect(view.costMs).toBeGreaterThanOrEqual(0);
    expect(view.worstMs).toBeLessThan(5);
    expect(w.sense.latest()).toBe(view);
  });

  it("a bot born knowing no threats sizes up nothing until it is hurt", () => {
    const w = world({ settings: { innateThreats: [], innateNeverFight: [] } });
    w.add(1, "zombie", 2);
    w.tick();
    expect(w.tick().threats).toEqual([]);
    w.tick({ self: { health: 17, lastHurt: w.hurtBy(1) } });
    expect(w.tick({ self: { health: 17, lastHurt: { ...w.hurtBy(1), msAgo: 500 } } }).threats).toMatchObject([{ kind: "zombie", stage: "on_it" }]);
  });
});
