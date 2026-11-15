import { describe, expect, it } from "vitest";
import { Vec3 } from "vec3";
import { fakeBot } from "./fake-bot.test-helper.js";
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

describe("holdGaze", () => {
  /** One physics tick: the pathfinder (played here by `steer`) runs between the gaze's two hooks. */
  function walker() {
    const fake = fakeBot();
    // The stand-in pathfinder faces north and presses forward and sprint, like the real one.
    let steer = () => {
      fake.state.entity.yaw = 0;
      fake.bot.setControlState("forward", true);
      fake.bot.setControlState("sprint", true);
    };
    fake.bot.on("physicsTick", () => steer());
    fake.setWalking(true);
    return { ...fake, tick: () => fake.emit("physicsTick"), setSteer: (next: () => void) => void (steer = next) };
  }
  const WEST = new Vec3(-20, 64.8, 0.5);

  it("turns the head to the point and walks the same way with other keys", () => {
    const bot = walker();
    const release = holdGaze(bot.bot, () => WEST);
    bot.tick();
    // Looking west (to the left of north), so travelling north is to the right of the gaze.
    expect(bot.state.entity.yaw).toBeCloseTo(Math.PI / 2);
    expect(bot.keysDown()).toEqual(["right"]);
    bot.tick();
    expect(bot.keysDown()).toEqual(["right"]);
    release();
    // Given back exactly as the pathfinder left it.
    expect(bot.keysDown()).toEqual(["forward", "sprint"]);
    expect(bot.state.entity.yaw).toBe(0);
  });

  it("keeps sprinting only when the gaze is straight ahead", () => {
    const bot = walker();
    holdGaze(bot.bot, () => new Vec3(0.5, 64.8, -20));
    bot.tick();
    expect(bot.keysDown()).toEqual(["forward", "sprint"]);
  });

  it("gives way while the pathfinder jumps, and when it is not walking", () => {
    const jumping = walker();
    jumping.setSteer(() => {
      jumping.state.entity.yaw = 0;
      jumping.bot.setControlState("forward", true);
      jumping.bot.setControlState("jump", true);
    });
    holdGaze(jumping.bot, () => WEST);
    jumping.tick();
    expect(jumping.state.entity.yaw).toBe(0);
    expect(jumping.keysDown()).toEqual(["forward", "jump"]);

    const standing = walker();
    standing.setWalking(false);
    holdGaze(standing.bot, () => WEST);
    standing.tick();
    expect(standing.state.entity.yaw).toBe(0);
  });

  it("follows a point that moves, and lets go for a tick when there is none", () => {
    const bot = walker();
    let point: Vec3 | null = WEST;
    holdGaze(bot.bot, () => point);
    bot.tick();
    expect(bot.keysDown()).toEqual(["right"]);
    point = new Vec3(20, 64.8, 0.5); // now to the east
    bot.tick();
    expect(bot.state.entity.yaw).toBeCloseTo(-Math.PI / 2);
    expect(bot.keysDown()).toEqual(["left"]);
    point = null;
    bot.tick();
    expect(bot.keysDown()).toEqual(["forward", "sprint"]);
  });
});
