import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeTraveller } from "./fake.test-helper.js";

const never = new AbortController().signal;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

describe("the locomotion controller: commands", () => {
  it("goTo arrives, reports the journey, and leaves no keys held", async () => {
    const t = fakeTraveller();
    const journey = t.locomotion.goTo(t.at(0, -20), { range: 1 }, never);
    await t.run(1000);
    expect(t.locomotion.status()).toMatchObject({ moving: true, pattern: "walk", stuck: false });
    expect(t.locomotion.status().progress).toBeGreaterThan(0.1);
    await t.run(6000);
    const result = await journey;
    expect(result.status).toBe("done");
    expect(result.changes).toMatchObject({ patternSwitches: 0, recoveries: 0, late: false, asExpected: true });
    expect(result.changes?.distance).toBeGreaterThan(17);
    expect(result.changes?.seconds).toBeGreaterThan(2);
    expect(t.keysDown()).toEqual([]);
    expect(t.locomotion.status()).toMatchObject({ moving: false, pattern: null, progress: 0 });
  });

  it("goTo fails with the reason when there is no route, with no keys held", async () => {
    const t = fakeTraveller();
    t.world.noPath = true;
    const journey = t.locomotion.goTo(t.at(0, -20), {}, never);
    await t.run(1000);
    expect(await journey).toMatchObject({ status: "failed", reason: "No path to the goal!", changes: { asExpected: false } });
    expect(t.keysDown()).toEqual([]);
    expect(t.calls.at(-1)).toBe("goal cleared");
  });

  it("is interrupted by its signal, standing still at once with no keys held", async () => {
    const t = fakeTraveller();
    const stop = new AbortController();
    const journey = t.locomotion.goTo(t.at(0, -40), {}, stop.signal);
    await t.run(1000);
    expect(t.keysDown()).toContain("forward");
    stop.abort(new Error("interrupted"));
    await t.run(50);
    expect((await journey).status).toBe("interrupted");
    expect(t.keysDown()).toEqual([]);
    const where = t.state.entity.position.clone();
    await t.run(1000);
    expect(t.state.entity.position).toEqual(where);
  });

  it("pause() freezes the legs for a moment without ending the journey, which then carries on and arrives", async () => {
    const t = fakeTraveller();
    const journey = t.locomotion.goTo(t.at(0, -20), {}, never);
    await t.run(1000);
    const before = t.state.entity.position.z;
    expect(t.locomotion.pause(150)).toBe(true);
    await t.run(100);
    // Frozen: no key held, no ground covered, and the journey is still under way.
    expect(t.keysDown()).toEqual([]);
    expect(t.locomotion.status().moving).toBe(true);
    const frozenAt = t.state.entity.position.z;
    expect(before - frozenAt).toBeLessThan(0.6);
    await t.run(400);
    expect(t.state.entity.position.z).toBeLessThan(frozenAt - 0.5);
    expect(t.logged).toContain("locomotion: carrying on after a pause");
    await t.run(8000);
    expect(await journey).toMatchObject({ status: "done" });
    expect(t.keysDown()).toEqual([]);
  });

  it("pause() with no journey under way does nothing", () => {
    expect(fakeTraveller().locomotion.pause(150)).toBe(false);
  });

  it("stop() ends travel now and releases every key", async () => {
    const t = fakeTraveller();
    const journey = t.locomotion.goTo(t.at(0, -40), {}, never);
    await t.run(1000);
    t.locomotion.stop();
    expect(t.keysDown()).toEqual([]);
    expect(t.calls.at(-1)).toBe("goal cleared");
    await t.run(50);
    expect((await journey).status).toBe("interrupted");
    expect(t.locomotion.status().moving).toBe(false);
  });

  it("an error inside a journey ends it as failed, with no keys held and the route dropped", async () => {
    const t = fakeTraveller();
    t.world.failSetGoal = true;
    const journey = t.locomotion.goTo(t.at(0, -20), {}, never);
    await t.run(100);
    expect(await journey).toMatchObject({ status: "failed", reason: "pathfinder broke" });
    expect(t.keysDown()).toEqual([]);
    expect(t.calls.at(-1)).toBe("goal cleared");
  });

  it("a new command replaces a running one cleanly", async () => {
    const t = fakeTraveller();
    const north = t.locomotion.goTo(t.at(0, -40), {}, never);
    await t.run(1000);
    const east = t.locomotion.goTo(t.at(8, t.state.entity.position.z - 0.5), {}, never);
    await t.run(100);
    expect((await north).status).toBe("interrupted");
    await t.run(4000);
    expect((await east).status).toBe("done");
    expect(Math.abs(t.state.entity.position.x - 8.5)).toBeLessThan(1.5);
    expect(t.keysDown()).toEqual([]);
  });

  it("follow keeps within range of something that moves, until stopped; once: done when first in range", async () => {
    const t = fakeTraveller();
    const friend = t.entity(7, 0, -10);
    const stop = new AbortController();
    const following = t.locomotion.follow(friend, { range: 2 }, stop.signal);
    await t.run(3000);
    expect(friend.position.distanceTo(t.state.entity.position)).toBeLessThan(3.5);
    friend.position.z -= 10; // it walks off
    await t.run(3000);
    expect(friend.position.distanceTo(t.state.entity.position)).toBeLessThan(3.5);
    stop.abort(new Error("interrupted"));
    await t.run(50);
    expect((await following).status).toBe("interrupted");
    expect(t.keysDown()).toEqual([]);

    const once = t.locomotion.follow(t.entity(8, 6, t.state.entity.position.z - 0.5), { range: 2, once: true }, never);
    await t.run(3000);
    expect((await once).status).toBe("done");
  });

  it("following, it sprints to catch up when it has fallen behind, even at a walking speed", async () => {
    const t = fakeTraveller();
    t.locomotion.setDrive({ speed: 0.1 });
    const friend = t.entity(7, 0, -30);
    void t.locomotion.follow(friend, { range: 2 }, never);
    await t.run(1000);
    expect(t.locomotion.status().gait).toBe("sprint");
    expect(t.keysDown()).toEqual(["forward", "sprint"]);
    await t.run(6000); // caught up
    expect(t.locomotion.status().gait).toBe("walk");
    t.locomotion.stop();
  });

  it("follow ends as done when what it follows is gone", async () => {
    const t = fakeTraveller();
    const friend = t.entity(7, 0, -30);
    const following = t.locomotion.follow(friend, { range: 2 }, never);
    await t.run(1000);
    (friend as { isValid: boolean }).isValid = false;
    await t.run(500);
    expect((await following).status).toBe("done");
    expect(t.keysDown()).toEqual([]);
  });

  it("awayFrom gets the asked distance from a threat, leaning toward a preferred place", async () => {
    const t = fakeTraveller();
    const zombie = t.entity(9, 0, 3); // just south of the bot
    const away = t.locomotion.awayFrom(zombie, { distance: 16, prefer: t.at(30, -30) }, never);
    await t.run(8000);
    expect((await away).status).toBe("done");
    const me = t.state.entity.position;
    expect(zombie.position.distanceTo(me)).toBeGreaterThanOrEqual(16);
    expect(me.x).toBeGreaterThan(3); // home is to the north-east: it leaned east as it went north
    expect(t.keysDown()).toEqual([]);
  });
});

describe("the locomotion controller: speed and caution", () => {
  /** How far the bot gets in three seconds at a speed command. */
  async function covered(speed: number, food = 20) {
    const t = fakeTraveller({ food });
    t.locomotion.setDrive({ speed });
    void t.locomotion.goTo(t.at(0, -200), {}, never);
    await t.run(3000);
    const result = { blocks: 0.5 - t.state.entity.position.z, gait: t.locomotion.status().gait, keys: t.keysDown() };
    t.locomotion.stop();
    return result;
  }

  it("speed sets the gait: a walk below 0.3, sprinting on straight stretches up to 0.7, sprinting above", async () => {
    const [slow, mid, fast] = [await covered(0.2), await covered(0.5), await covered(0.9)];
    expect([slow.gait, mid.gait, fast.gait]).toEqual(["walk", "jog", "sprint"]);
    expect(slow.keys).toEqual(["forward"]);
    expect(fast.keys).toEqual(["forward", "sprint"]);
    // A jog walks until the stretch has proved straight, then sprints: in between the other two.
    expect(mid.blocks).toBeGreaterThan(slow.blocks);
    expect(fast.blocks).toBeGreaterThan(mid.blocks);
  });

  it("never sprints when food is too low to, whatever the speed", async () => {
    const hungry = await covered(1, 6);
    expect(hungry.gait).toBe("walk");
    expect(hungry.keys).toEqual(["forward"]);
    expect((await covered(1, 7)).keys).toEqual(["forward", "sprint"]);
  });

  it("the drive can be changed mid-journey", async () => {
    const t = fakeTraveller();
    t.locomotion.setDrive({ speed: 0.1 });
    void t.locomotion.goTo(t.at(0, -200), {}, never);
    await t.run(1000);
    expect(t.keysDown()).toEqual(["forward"]);
    t.locomotion.setDrive({ speed: 1 });
    await t.run(200);
    expect(t.keysDown()).toEqual(["forward", "sprint"]);
  });

  it("caution above 0.6 switches to the careful rules, and back", async () => {
    const t = fakeTraveller();
    expect(t.calls).toEqual(["rules normal"]);
    void t.locomotion.goTo(t.at(0, -200), {}, never);
    t.locomotion.setDrive({ caution: 0.8 });
    await t.run(500);
    expect(t.calls.filter((c) => c.startsWith("rules"))).toEqual(["rules normal", "rules careful"]);
    t.locomotion.setDrive({ caution: 0.5 });
    await t.run(500);
    expect(t.calls.filter((c) => c.startsWith("rules")).at(-1)).toBe("rules normal");
  });

  it("being careful sneaks within one block of a drop of 3 or more, and only there", async () => {
    // A pit three deep, just west of the bot's path, eight blocks north.
    const pit = Object.fromEntries([62, 61, 60].map((y) => [`-1,${y},-8`, "air"]));
    const t = fakeTraveller({ blocks: pit });
    t.locomotion.setDrive({ caution: 0.8, speed: 0.1 });
    void t.locomotion.goTo(t.at(0, -30), {}, never);
    let sneaked = false;
    let sneakedFarFromPit = false;
    for (let i = 0; i < 80; i++) {
      await t.run(50);
      const z = Math.floor(t.state.entity.position.z);
      if (t.keysDown().includes("sneak")) {
        sneaked = true;
        if (Math.abs(z + 8) > 2) sneakedFarFromPit = true; // one tick's grace either side
      }
    }
    expect(sneaked).toBe(true);
    expect(sneakedFarFromPit).toBe(false);

    const careless = fakeTraveller({ blocks: pit });
    t.locomotion.stop();
    careless.locomotion.setDrive({ caution: 0.3, speed: 0.1 });
    void careless.locomotion.goTo(careless.at(0, -30), {}, never);
    for (let i = 0; i < 80; i++) {
      await careless.run(50);
      expect(careless.keysDown()).not.toContain("sneak");
    }
  });
});

describe("the locomotion controller: feeling the ground", () => {
  it("detects being stuck after 1.5 s without progress, tries jump, sidestep, then planning again, then fails as stuck", async () => {
    const t = fakeTraveller();
    const journey = t.locomotion.goTo(t.at(0, -20), {}, never);
    await t.run(500);
    t.world.blocked = true;
    await t.run(1200);
    expect(t.locomotion.status()).toMatchObject({ stuck: false, recoveries: 0 }); // not yet 1.5 s
    await t.run(800);
    expect(t.locomotion.status()).toMatchObject({ stuck: true, recoveries: 1 });
    for (let i = 0; i < 60 && t.locomotion.status().moving; i++) await t.run(250);
    const result = await journey;
    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/^stuck at 0,63,-\d+$/);
    expect(result.changes).toMatchObject({ recoveries: 3, recovered: "jump, sidestep, replan" });
    expect(t.logged.filter((l) => l.includes("trying")).map((l) => l.split("trying ")[1])).toEqual(["jump (1 of 3)", "sidestep (2 of 3)", "replan (3 of 3)"]);
    expect(t.keysDown()).toEqual([]);
    // `stuck` stays up for a moment after giving up, so a once-a-tick reader sees it.
    expect(t.locomotion.status().stuck).toBe(true);
    await t.run(1500);
    expect(t.locomotion.status().stuck).toBe(false);
  });

  it("a recovery that works lets the journey carry on, and the tries start again", async () => {
    const t = fakeTraveller();
    const journey = t.locomotion.goTo(t.at(0, -30), {}, never);
    await t.run(500);
    t.world.blocked = true;
    await t.run(2200);
    t.world.blocked = false; // the hop got it over the lip
    await t.run(8000);
    const result = await journey;
    expect(result).toMatchObject({ status: "done", changes: { recoveries: 1, recovered: "jump" } });
    expect(t.locomotion.status().stuck).toBe(false);
  });

  it("an urgent journey skips the fiddling: every recovery is planning again", async () => {
    const t = fakeTraveller();
    const journey = t.locomotion.goTo(t.at(0, -20), { urgent: true }, never);
    await t.run(300);
    expect(t.locomotion.status().pattern).toBe("dash");
    t.world.blocked = true;
    await t.run(9000);
    expect(await journey).toMatchObject({ status: "failed", changes: { recovered: "replan, replan, replan" } });
    expect(t.keysDown()).toEqual([]);
  });

  it("failing as stuck three times at one place within a minute marks the spot to avoid", async () => {
    const t = fakeTraveller();
    t.world.blocked = true;
    for (let i = 0; i < 3; i++) {
      const journey = t.locomotion.goTo(t.at(0, -20), {}, never);
      await t.run(9000);
      expect((await journey).status).toBe("failed");
    }
    expect(t.logged.at(-1)).toMatch(/stuck here three times: avoiding 0,63,0 for 5 minutes/);
  });

  it("entering water switches to swimming, and leaving it switches back, without the caller noticing", async () => {
    // A pond two deep across the path, from 8 to 13 blocks north.
    const pond: Record<string, string> = {};
    for (let z = -13; z <= -8; z++) for (const y of [62, 63]) pond[`0,${y},${z}`] = "water";
    const t = fakeTraveller({ blocks: pond });
    const journey = t.locomotion.goTo(t.at(0, -24), {}, never);
    const patterns = new Set<string>();
    for (let i = 0; i < 120 && t.locomotion.status().moving; i++) {
      await t.run(100);
      const pattern = t.locomotion.status().pattern;
      if (pattern) patterns.add(pattern);
    }
    const result = await journey;
    expect(result).toMatchObject({ status: "done", changes: { patternSwitches: 2 } });
    expect([...patterns]).toEqual(["walk", "swim"]);
    expect(t.logged.filter((l) => l.includes("→"))).toEqual(["locomotion: walk → swim", "locomotion: swim → walk"]);
    expect(t.keysDown()).toEqual([]);
  });

  it("sets late when a journey overruns twice its estimate, and not otherwise", async () => {
    const onTime = fakeTraveller();
    const quick = onTime.locomotion.goTo(onTime.at(0, -20), {}, never);
    await onTime.run(7000);
    expect((await quick).changes).toMatchObject({ late: false, asExpected: true });

    // The route looked 20 blocks long (about 4 s), but the bot is held up for a long while on the way.
    const held = fakeTraveller();
    const slow = held.locomotion.goTo(held.at(0, -20), {}, never);
    await held.run(1000);
    for (let i = 0; i < 12; i++) {
      held.world.blocked = true;
      await held.run(1000);
      held.world.blocked = false;
      await held.run(300);
    }
    await held.run(6000);
    const result = await slow;
    expect(result.status).toBe("done");
    expect(result.changes).toMatchObject({ late: true, asExpected: false });
  });

  it("logs a single round of planning that takes over 100 ms", () => {
    const t = fakeTraveller();
    t.emit("path_update", { status: "success", path: [{}], time: 40 });
    expect(t.logged).toEqual([]);
    // A long search reports its running total: only a single slow round is logged.
    t.emit("path_update", { status: "partial", path: [{}], time: 90 });
    t.emit("path_update", { status: "partial", path: [{}], time: 150 });
    expect(t.logged).toEqual([]);
    t.emit("path_update", { status: "success", path: [{}], time: 330 });
    expect(t.logged).toEqual(["locomotion: one round of planning took 180 ms (success)"]);
    expect([t.state.pathfinder.thinkTimeout, t.state.pathfinder.tickTimeout]).toEqual([3000, 15]);
  });

  describe("an area to keep clear of", () => {
    it("routes steer round it while it lasts, and a renewal moves it", async () => {
      const t = fakeTraveller();
      t.locomotion.avoidArea("entity:7", { x: 10, y: 63, z: 0 }, 4, 3000);
      expect(t.avoided(10, 0)).toBe(true);
      expect(t.avoided(13, 0)).toBe(true);
      expect(t.avoided(15, 0)).toBe(false);
      t.locomotion.avoidArea("entity:7", { x: 20, y: 63, z: 0 }, 4, 3000);
      expect(t.avoided(10, 0)).toBe(false);
      expect(t.avoided(20, 0)).toBe(true);
      await t.run(3100);
      expect(t.avoided(20, 0)).toBe(false);
      t.locomotion.avoidArea("entity:7", { x: 20, y: 63, z: 0 }, 4, 3000);
      t.locomotion.forget();
      expect(t.avoided(20, 0)).toBe(false);
    });

    it("a journey under way is planned again when an area appears or moves, at most once a second", async () => {
      const t = fakeTraveller();
      const journey = t.locomotion.goTo(t.at(30, 0), {}, new AbortController().signal);
      await t.run(1500);
      const goals = () => t.calls.filter((c) => c === "goal set").length;
      const before = goals();
      t.locomotion.avoidArea("entity:7", { x: 15, y: 63, z: 3 }, 4, 3000);
      expect(goals()).toBe(before + 1);
      expect(t.logged).toContain("locomotion: routing round entity:7");
      // Renewed in the same place, or moved again within the second: no new plan.
      t.locomotion.avoidArea("entity:7", { x: 15, y: 63, z: 3 }, 4, 3000);
      t.locomotion.avoidArea("entity:7", { x: 15, y: 63, z: 9 }, 4, 3000);
      expect(goals()).toBe(before + 1);
      t.locomotion.stop();
      await journey;
    });
  });
});
