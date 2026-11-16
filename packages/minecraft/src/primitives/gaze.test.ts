import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Vec3 } from "vec3";
import { fakeTraveller } from "../locomotion/fake.test-helper.js";
import { createDither, holdGaze, keysFor } from "./gaze.js";

const DEG = Math.PI / 180;
const pressed = (angle: number) => Object.entries(keysFor(angle * DEG)).filter(([, down]) => down).map(([key]) => key).sort().join("+");

describe("keysFor", () => {
  it("gives the key combination for each of the eight directions, measured leftward from the gaze", () => {
    expect([0, 45, 90, 135, 180, 225, 270, 315].map(pressed)).toEqual(["forward", "forward+left", "left", "back+left", "back", "back+right", "right", "forward+right"]);
  });

  it("snaps to the nearest and handles negative and large angles", () => {
    expect([10, -10, 30, -90, 370, -350].map(pressed)).toEqual(["forward", "forward", "forward+left", "right", "forward", "forward"]);
  });
});

describe("createDither", () => {
  it("averages to the true heading by switching between the two nearest directions", () => {
    const dither = createDither();
    const angle = 20 * DEG; // between forward (0) and forward+left (45)
    const used = Array.from({ length: 90 }, () => dither(angle));
    expect(new Set(used.map((a) => Math.round(a / DEG)))).toEqual(new Set([0, 45]));
    expect(used.reduce((sum, a) => sum + a, 0) / used.length / DEG).toBeCloseTo(20, 0);
  });

  it("leaves an exact direction alone", () => {
    const dither = createDither();
    expect([dither(90 * DEG), dither(90 * DEG), dither(90 * DEG)].map((a) => Math.round(a / DEG))).toEqual([90, 90, 90]);
  });
});

describe("holdGaze, through the locomotion controller", () => {
  const never = new AbortController().signal;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  /** A bot walking north on a long journey. */
  async function walker(speed = 0.2) {
    const t = fakeTraveller();
    t.locomotion.setDrive({ speed });
    void t.locomotion.goTo(t.at(0, -200), {}, never);
    await t.run(500);
    const eye = () => t.state.entity.position.offset(0, 1.8, 0);
    return { ...t, eye };
  }
  const west = (t: { state: { entity: { position: Vec3 } } }) => t.state.entity.position.offset(-30, 1.8, 0);

  it("turns the head to the point and keeps walking the same way with other keys", async () => {
    const t = await walker();
    const before = t.state.entity.position.clone();
    const release = holdGaze(t.locomotion, t.eye, () => west(t));
    await t.run(1000);
    // Looking west (to the left of north), so travelling north is to the right of the gaze.
    expect(t.state.entity.yaw).toBeCloseTo(Math.PI / 2, 1);
    expect(t.keysDown()).toEqual(["right"]);
    const moved = t.state.entity.position.minus(before);
    expect(moved.z).toBeLessThan(-3); // still heading north
    expect(Math.abs(moved.x)).toBeLessThan(0.5); // and not drifting toward what it looks at
    release();
    await t.run(100);
    expect(t.keysDown()).toEqual(["forward"]);
    expect(t.state.entity.yaw).toBeCloseTo(0, 1);
  });

  it("keeps sprinting only when the gaze is straight ahead", async () => {
    const t = await walker(1);
    holdGaze(t.locomotion, t.eye, () => t.state.entity.position.offset(0, 1.8, -30));
    await t.run(200);
    expect(t.keysDown()).toEqual(["forward", "sprint"]);
    holdGaze(t.locomotion, t.eye, () => west(t));
    await t.run(200);
    expect(t.keysDown()).toEqual(["right"]);
  });

  it("does nothing when the bot is not walking, and lets go for a tick when there is no point", async () => {
    const standing = fakeTraveller();
    holdGaze(standing.locomotion, () => standing.state.entity.position, () => new Vec3(-30, 64, 0));
    await standing.run(200);
    expect(standing.state.entity.yaw).toBe(0);

    const t = await walker();
    let point: Vec3 | null = west(t);
    holdGaze(t.locomotion, t.eye, () => point);
    await t.run(200);
    expect(t.keysDown()).toEqual(["right"]);
    point = null;
    await t.run(200);
    expect(t.keysDown()).toEqual(["forward"]);
  });

  it("follows a point that moves", async () => {
    const t = await walker();
    let east = false;
    holdGaze(t.locomotion, t.eye, () => t.state.entity.position.offset(east ? 30 : -30, 1.8, 0));
    await t.run(200);
    expect(t.keysDown()).toEqual(["right"]);
    east = true;
    await t.run(200);
    expect(t.state.entity.yaw).toBeCloseTo(-Math.PI / 2, 1);
    expect(t.keysDown()).toEqual(["left"]);
  });
});
