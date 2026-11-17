import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Vec3 } from "vec3";
import { DEFAULT_POSTURE } from "../brain/posture.js";
import { fakeTraveller } from "../locomotion/fake.test-helper.js";
import { setUpPosture } from "./install.js";
import { surfaceKind } from "./surfaces.js";

describe("setUpPosture", () => {
  const never = new AbortController().signal;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => void vi.useRealTimers());

  function setUp(settings = DEFAULT_POSTURE) {
    const t = fakeTraveller();
    Object.assign(t.state, { game: { dimension: "overworld" }, health: 20, players: {} });
    const logged: string[] = [];
    const posture = setUpPosture(t.bot, { settings, locomotion: t.locomotion, log: (msg) => logged.push(msg) });
    return { ...t, posture, logged };
  }

  it("moved somewhere else mid-journey: the journey stops, the old marks are forgotten, and it is reported once", async () => {
    const t = setUp();
    t.locomotion.avoid({ x: 5, y: 63, z: 5 });
    expect(t.avoided(5, 5)).toBe(true);
    const journey = t.locomotion.goTo(t.at(0, -100), {}, never);
    await t.run(1000);
    expect(t.locomotion.status().moving).toBe(true);
    expect(t.posture.displaced()).toBe(false);

    // A teleport: 50 blocks east in one tick.
    t.state.entity.position = t.state.entity.position.offset(50, 0, 0);
    await t.run(300);
    expect((await journey).status).toBe("interrupted");
    expect(t.locomotion.status()).toMatchObject({ moving: false, stuck: false });
    expect(t.keysDown()).toEqual([]);
    expect(t.avoided(5, 5)).toBe(false);
    expect(t.posture.displaced()).toBe(true);
    expect(t.posture.displaced()).toBe(false);
    expect(t.posture.notes().displaced).toHaveLength(1);
    expect(t.logged.join("\n")).toContain("journey stopped, old marks forgotten");
    // It does not set off for the old route again by itself.
    const x = t.state.entity.position.x;
    await t.run(1000);
    expect(t.state.entity.position.x).toBe(x);
  });

  it("with the reaction switched off, a teleport changes nothing", async () => {
    const t = setUp({ ...DEFAULT_POSTURE, displaced: 0 });
    t.locomotion.avoid({ x: 5, y: 63, z: 5 });
    void t.locomotion.goTo(t.at(0, -100), {}, never);
    await t.run(500);
    t.state.entity.position = t.state.entity.position.offset(50, 0, 0);
    await t.run(300);
    expect(t.locomotion.status().moving).toBe(true);
    expect(t.avoided(5, 5)).toBe(true);
    expect(t.posture.displaced()).toBe(false);
  });

  it("a fall that hurt marks the edge the bot went over as a spot to avoid; a harmless one does not", async () => {
    const t = setUp();
    const fall = async (damage: number, x: number) => {
      t.state.entity.position = new Vec3(x + 0.5, 71, 0.5);
      t.emit("physicsTick");
      Object.assign(t.state.entity, { onGround: false, position: new Vec3(x + 1.2, 71, 0.5) });
      t.emit("physicsTick");
      Object.assign(t.state.entity, { onGround: false, position: new Vec3(x + 1.5, 67, 0.5) });
      t.emit("physicsTick");
      Object.assign(t.state.entity, { onGround: true, position: new Vec3(x + 1.5, 63, 0.5) });
      t.emit("physicsTick");
      Object.assign(t.state, { health: 20 - damage });
      await vi.advanceTimersByTimeAsync(400);
      Object.assign(t.state, { health: 20 });
    };
    await fall(0, 0);
    expect(t.avoided(0, 0, 71)).toBe(false);
    await fall(5, 4);
    expect(t.avoided(4, 0, 71)).toBe(true);
    expect(t.posture.notes().falls).toEqual([
      { blocks: 8, damage: 0, steered: false, onto: "stone" },
      { blocks: 8, damage: 5, steered: false, onto: "stone", note: "no better landing in reach: nothing to do" },
    ]);
  });

  it("gives the bot only the loose blocks its settings list", () => {
    const born = setUp();
    expect(surfaceKind(born.bot, "gravel")).toBe("loose");
    const blank = setUp({ ...DEFAULT_POSTURE, innateLoose: [] });
    expect(surfaceKind(blank.bot, "gravel")).toBeNull();
    expect(blank.posture.surfaces.entries()).toEqual({ loose: {}, slippery: {}, slow: {} });
  });
});
