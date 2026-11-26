import { describe, expect, it } from "vitest";
import { Vec3 } from "vec3";
import { doorWay } from "./door.js";
import { createStuckSense, recoveryFor } from "./feel.js";
import { allowSprint, canSprint, createStraightness, gaitOf } from "./gait.js";
import { awayPoint, goToJourney } from "./journeys.js";
import { createStuckSpots } from "./spots.js";

describe("gait", () => {
  it("is a walk below 0.3, a jog up to 0.7, a sprint above", () => {
    expect([0, 0.29, 0.3, 0.7, 0.71, 1].map(gaitOf)).toEqual(["walk", "walk", "jog", "jog", "sprint", "sprint"]);
  });

  it("allows a sprint only when the game does (food above 6) and the gait calls for it", () => {
    expect([canSprint(6), canSprint(7)]).toEqual([false, true]);
    expect(allowSprint("sprint", 20, false)).toBe(true);
    expect(allowSprint("sprint", 6, true)).toBe(false);
    expect(allowSprint("walk", 20, true)).toBe(false);
    expect([allowSprint("jog", 20, true), allowSprint("jog", 20, false)]).toEqual([true, false]);
  });

  it("a stretch is straight once the heading has held steady for a while, and a turn starts it again", () => {
    const stretch = createStraightness();
    expect(stretch.straight(0, 0)).toBe(false);
    expect(stretch.straight(0.05, 500)).toBe(false);
    expect(stretch.straight(0.05, 900)).toBe(true);
    expect(stretch.straight(1.2, 1000)).toBe(false); // a turn
    expect(stretch.straight(1.2, 1900)).toBe(true);
    stretch.restart();
    expect(stretch.straight(1.2, 2000)).toBe(false);
  });
});

describe("feeling stuck", () => {
  const at = (z: number) => new Vec3(0, 63, z);

  it("is stuck after 1.5 s of covering less than half a block while supposed to be moving", () => {
    const sense = createStuckSense();
    const felt = [0, 250, 500, 750, 1000, 1250, 1500].map((t) => sense.feel(at(0.1 * (t / 1500)), true, t));
    expect(felt).toEqual([false, false, false, false, false, false, true]);
  });

  it("is not stuck while it covers ground, while standing on purpose, or just after a reset", () => {
    const moving = createStuckSense();
    for (let t = 0; t <= 3000; t += 250) expect(moving.feel(at(t / 250), true, t)).toBe(false);
    const digging = createStuckSense();
    for (let t = 0; t <= 3000; t += 250) expect(digging.feel(at(0), false, t)).toBe(false);
    const sense = createStuckSense();
    for (let t = 0; t <= 1500; t += 250) sense.feel(at(0), true, t);
    sense.reset();
    expect(sense.feel(at(0), true, 1750)).toBe(false);
  });

  it("tries jump, then a sidestep, then planning again, then gives up; anything but a plain walk only plans again", () => {
    expect([0, 1, 2, 3].map((n) => recoveryFor(n, true))).toEqual(["jump", "sidestep", "replan", null]);
    expect([0, 1, 2, 3].map((n) => recoveryFor(n, false))).toEqual(["replan", "replan", "replan", null]);
  });
});

describe("stuck spots", () => {
  const here = new Vec3(10.5, 63, 10.5);

  it("marks a spot after three failures there within a minute, and avoids it for 5 minutes", () => {
    const spots = createStuckSpots();
    expect([spots.failedAt(here, 0), spots.failedAt(here, 20_000)]).toEqual([false, false]);
    expect(spots.avoid(here, 20_000)).toBe(false);
    expect(spots.failedAt(here.offset(1, 0, 0), 40_000)).toBe(true);
    expect(spots.avoid({ x: 10, y: 63, z: 10 }, 60_000)).toBe(true);
    expect(spots.avoid({ x: 14, y: 63, z: 10 }, 60_000)).toBe(false);
    expect(spots.avoid({ x: 10, y: 63, z: 10 }, 40_000 + 300_001)).toBe(false);
  });

  it("does not mark failures spread over more than a minute, or in different places", () => {
    const slow = createStuckSpots();
    expect([slow.failedAt(here, 0), slow.failedAt(here, 50_000), slow.failedAt(here, 100_000)]).toEqual([false, false, false]);
    const apart = createStuckSpots();
    expect([apart.failedAt(here, 0), apart.failedAt(here.offset(9, 0, 0), 1000), apart.failedAt(here.offset(0, 0, 9), 2000)]).toEqual([false, false, false]);
  });
});

describe("doorWay", () => {
  const door = new Vec3(5, 63, 0); // a door in a wall that runs north-south: the way through is along x

  it("is used when the bot and its aim are on opposite sides and the straight line passes through it", () => {
    const way = doorWay(new Vec3(2.5, 63, 0.5), new Vec3(9.5, 63, 0.5), door, "x");
    expect(way).toMatchObject({ front: new Vec3(4, 63, 0), through: new Vec3(1, 0, 0) });
    expect(way!.beyond.x).toBeCloseTo(7.1);
    // From the other side, it goes the other way.
    expect(doorWay(new Vec3(9.5, 63, 0.5), new Vec3(2.5, 63, 0.5), door, "x")).toMatchObject({ front: new Vec3(6, 63, 0), through: new Vec3(-1, 0, 0) });
  });

  it("is not used when both are on one side, the line passes well to one side of it, or it is on another floor", () => {
    expect(doorWay(new Vec3(2.5, 63, 0.5), new Vec3(3.5, 63, 4.5), door, "x")).toBeNull();
    expect(doorWay(new Vec3(2.5, 63, 6.5), new Vec3(9.5, 63, 6.5), door, "x")).toBeNull();
    expect(doorWay(new Vec3(2.5, 67, 0.5), new Vec3(9.5, 67, 0.5), door, "x")).toBeNull();
  });
});

describe("awayPoint", () => {
  it("heads straight away from the threat, leaning toward a preferred place unless that is toward the threat", () => {
    const me = new Vec3(0, 63, 0);
    const threat = new Vec3(0, 63, 3); // to the south
    expect(awayPoint(me, threat)).toEqual(new Vec3(0, 63, -8));
    const leaning = awayPoint(me, threat, new Vec3(30, 63, -30));
    expect(leaning.x).toBeGreaterThan(2);
    expect(leaning.z).toBeLessThan(-5);
    // Home is behind the threat: ignore it.
    expect(awayPoint(me, threat, new Vec3(0, 63, 30))).toEqual(new Vec3(0, 63, -8));
  });
});

describe("a journey by known spots", () => {
  const bot = (at: Vec3) => ({ entity: { position: at }, world: {} }) as never;
  const near = (goal: unknown) => goal as { x: number; rangeSq: number };

  it("heads for each spot in turn, then for the end, and has not arrived until the spots are passed", () => {
    const me = new Vec3(0, 64, 0);
    const journey = goToJourney(bot(me), new Vec3(40, 64, 0), { via: [new Vec3(10, 64, 0), new Vec3(20, 64, 0)] });
    expect(near(journey.goal()).x).toBe(10);
    expect(journey.advance!(false)).toBe(false);
    // The walk reached its goal, but that goal was only a spot on the way.
    me.x = 9;
    expect(journey.arrived(true, false)).toBe(false);
    expect(journey.advance!(false)).toBe(true);
    expect(near(journey.goal()).x).toBe(20);
    // Close to the end, the spots left are dropped.
    me.x = 30;
    expect(journey.advance!(false)).toBe(true);
    expect(near(journey.goal()).x).toBe(40);
    expect(journey.advance!(false)).toBe(false);
    expect(journey.arrived(true, false)).toBe(true);
  });

  it("drops the spots and heads straight for the end when a leg has no route", () => {
    const journey = goToJourney(bot(new Vec3(0, 64, 0)), new Vec3(40, 64, 0), { via: [new Vec3(10, 64, 0)] });
    expect(journey.advance!(true)).toBe(true);
    expect(near(journey.goal()).x).toBe(40);
  });

  it("with no spots is the journey it always was", () => {
    const journey = goToJourney(bot(new Vec3(0, 64, 0)), new Vec3(40, 64, 0), {});
    expect(journey.advance!(true)).toBe(false);
    expect(journey.arrived(true, false)).toBe(true);
  });
});
