import { describe, expect, it, vi } from "vitest";
import { Vec3 } from "vec3";
import { createPain, type Hurt } from "../pain.js";
import { fakeBot, type FakeOptions } from "../primitives/fake-bot.test-helper.js";
import { dangerAt, isDangerousBlock, isSafeToStand, setKnownHurts, touchesHurt } from "../safety.js";
import { digOut } from "./dig-out.js";
import { recoil, steady } from "./recoil.js";
import { refugeFrom, withdraw } from "./withdraw.js";

const never = new AbortController().signal;
const HERE = new Vec3(0, 63, 0);
const cactusHurt = (at = 0): Hurt => ({ at, by: null, kind: "cactus", where: { x: 0, y: 63, z: 0 }, touching: { feet: "air", head: "air", below: "stone", sides: ["cactus", "air", "air", "air"] } });

/** A fake bot with its own pain record, whose "travel" simply arrives. */
function body(options: FakeOptions = {}, innate = ["lava", "fire", "soul_fire"], learned: Record<string, number> = {}) {
  const fake = fakeBot(options);
  const pain = createPain({ innate, learned });
  setKnownHurts(fake.bot, pain.knows);
  let hurt: Hurt | null = null;
  const went: Vec3[] = [];
  const avoided: unknown[] = [];
  fake.ctx.pain = pain;
  fake.ctx.lastHurt = () => hurt;
  fake.ctx.locomotion = {
    ...fake.ctx.locomotion,
    avoid: (spot: unknown) => void avoided.push(spot),
    goTo: async (place: Vec3) => {
      went.push(place);
      fake.state.entity.position = place.clone();
      return { status: "done" as const, changes: { distance: 2 } };
    },
  } as unknown as typeof fake.ctx.locomotion;
  return { ...fake, pain, went, avoided, hurtBy: (h: Hurt) => void (hurt = h) };
}

describe("refugeFrom", () => {
  it("picks the nearest safe place at least the asked distance from where it hurt", () => {
    const { bot } = body({ blocks: { "1,63,0": "cactus" } });
    const two = refugeFrom(bot, HERE, 2)!;
    expect(two.distanceTo(HERE)).toBeGreaterThanOrEqual(2);
    expect(two.distanceTo(HERE)).toBeLessThan(3);
    expect(isSafeToStand(bot, two)).toBe(true);
    expect(refugeFrom(bot, HERE, 4)!.distanceTo(HERE)).toBeGreaterThanOrEqual(4);
  });

  it("the place it picks must itself hold: not beside something known to hurt, not at the edge of a drop", () => {
    // Lava to the west, a cliff to the east: only north and south are open.
    const blocks: Record<string, string> = {};
    for (let z = -6; z <= 6; z++) {
      blocks[`-2,63,${z}`] = "lava";
      for (const y of [62, 61, 60, 59]) blocks[`3,${y},${z}`] = "air";
    }
    const { bot } = body({ blocks });
    const refuge = refugeFrom(bot, HERE, 2)!;
    expect(touchesHurt(bot, refuge)).toBe(false);
    expect(refuge.x).toBeGreaterThanOrEqual(0); // not next to the lava
    expect(refuge.x).toBeLessThan(2); // not on the cliff's edge
  });

  it("is null when nowhere within 6 blocks is safe", () => {
    // A one-block pillar in a sea of lava.
    const blocks: Record<string, string> = {};
    for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) if (x || z) blocks[`${x},62,${z}`] = "lava";
    expect(refugeFrom(body({ blocks }).bot, HERE, 2)).toBeNull();
  });
});

describe("withdraw", () => {
  it("pulls back at least 2 blocks, marks the spot, and reports the cause and the time from hurt to start", async () => {
    const b = body({ blocks: { "1,63,0": "cactus" } });
    b.hurtBy(cactusHurt(Date.now() - 120));
    const result = await withdraw.run(b.ctx, undefined, never);
    expect(result.status).toBe("done");
    expect(b.went[0]!.distanceTo(HERE.offset(0.5, 0, 0.5))).toBeGreaterThanOrEqual(1.5);
    expect(b.avoided).toEqual([{ x: 0, y: 63, z: 0 }]);
    expect(b.log).toContain("path cleared"); // whatever was carrying it there is switched off
    expect(result.changes).toMatchObject({ cause: "cactus", hurtAt: "0,63,0", radius: 2 });
    expect(result.changes?.hurtToStartMs).toBeGreaterThanOrEqual(120);
    expect(result.changes?.hurtToStartMs).toBeLessThan(400);
  });

  it("widens to 4, then 6, when hurt again at the same place", async () => {
    const b = body({ blocks: { "1,63,0": "cactus" } });
    const radii: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      b.state.entity.position = new Vec3(0.5, 63, 0.5);
      b.hurtBy(cactusHurt(Date.now()));
      radii.push((await withdraw.run(b.ctx, undefined, never)).changes?.radius);
    }
    expect(radii).toEqual([2, 4, 6]);
    expect(b.went[2]!.distanceTo(HERE.offset(0.5, 0, 0.5))).toBeGreaterThanOrEqual(5.5);
  });

  it("stays put when nowhere is safe: it never walks into worse", async () => {
    const blocks: Record<string, string> = {};
    for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) if (x || z) blocks[`${x},62,${z}`] = "lava";
    const b = body({ blocks });
    b.hurtBy(cactusHurt(Date.now()));
    const result = await withdraw.run(b.ctx, undefined, never);
    expect(result).toMatchObject({ status: "failed", reason: "nowhere safe within 6 blocks" });
    expect(b.went).toEqual([]);
    expect(b.state.entity.position).toEqual(new Vec3(0.5, 63, 0.5));
  });

  it("says what it learned, on the second separate incident", async () => {
    const b = body({ blocks: { "1,63,0": "cactus" } });
    const clock = vi.spyOn(Date, "now");
    try {
      clock.mockReturnValue(10_000);
      b.hurtBy(cactusHurt(9900));
      expect((await withdraw.run(b.ctx, undefined, never)).changes?.learned).toBeUndefined();
      expect(b.pain.knows("cactus")).toBe(false);
      clock.mockReturnValue(20_000);
      b.hurtBy(cactusHurt(19_900));
      expect((await withdraw.run(b.ctx, undefined, never)).changes?.learned).toBe("cactus");
      expect(b.pain.knows("cactus")).toBe(true);
    } finally {
      clock.mockRestore();
    }
  });
});

describe("learning what hurts changes what is safe", () => {
  it("one incident: not yet. Two: known to hurt, and standing next to it or on it is refused", () => {
    const b = body({ blocks: { "3,63,0": "cactus", "0,62,-3": "magma_block" } });
    const beside = new Vec3(2, 63, 0);
    const onMagma = new Vec3(0, 63, -3);
    expect([touchesHurt(b.bot, beside), isSafeToStand(b.bot, onMagma), dangerAt(b.bot, onMagma)]).toEqual([false, true, null]);
    b.pain.withdrew(cactusHurt(), 0);
    expect(isDangerousBlock("cactus", b.bot)).toBe(false);
    b.pain.withdrew(cactusHurt(), 5000);
    expect(isDangerousBlock("cactus", b.bot)).toBe(true);
    expect(touchesHurt(b.bot, beside)).toBe(true);
    const hot = { ...cactusHurt(), kind: "hot_floor", touching: { feet: "air", head: "air", below: "magma_block", sides: ["air", "air", "air", "air"] } };
    b.pain.withdrew(hot, 10_000);
    b.pain.withdrew(hot, 20_000);
    expect([isSafeToStand(b.bot, onMagma), dangerAt(b.bot, onMagma)]).toEqual([false, "magma_block"]);
  });

  it("a mob attack never teaches it", () => {
    const b = body();
    const struck = { ...cactusHurt(), by: "entity:9", kind: "mob_attack", touching: { feet: "air", head: "air", below: "stone", sides: ["air", "air", "air", "air"] } };
    for (const at of [0, 5000, 10_000]) b.pain.withdrew(struck, at);
    expect(isDangerousBlock("stone", b.bot)).toBe(false);
  });

  it("with nothing innate, cactus is unknown until learned; a bot never told anything knows the usual five", () => {
    const naive = body({}, []);
    expect([isDangerousBlock("cactus", naive.bot), isDangerousBlock("lava", naive.bot)]).toEqual([false, false]);
    expect([isDangerousBlock("cactus"), isDangerousBlock("lava"), isDangerousBlock("stone")]).toEqual([true, true, false]);
    expect(isDangerousBlock("cactus", body({}, [], { cactus: 2 }).bot)).toBe(true);
  });
});

describe("dig_out", () => {
  it("moves to open space when that is quicker than breaking the block", async () => {
    const b = body({ blocks: { "0,64,0": "stone" }, digMs: 5000 });
    expect(digOut.canRun(b.ctx)).toBe(true);
    const result = await digOut.run(b.ctx, undefined, never);
    expect(result).toMatchObject({ status: "done", changes: { how: "moved to open space" } });
    expect(b.went).toHaveLength(1);
  });

  it("breaks the block at head height when it is boxed in", async () => {
    const blocks: Record<string, string> = { "0,64,0": "dirt" };
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2], [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [-1, 2], [1, -2], [-1, -2], [2, 2], [2, -2], [-2, 2], [-2, -2]]) {
      for (const y of [61, 62, 63, 64, 65, 66]) blocks[`${x},${y},${z}`] = "stone";
    }
    const b = body({ blocks, digMs: 30 });
    const result = await digOut.run(b.ctx, undefined, never);
    expect(result).toMatchObject({ status: "done", changes: { how: "broke the dirt" } });
    expect(b.blockName(0, 64, 0)).toBe("air");
  });

  it("cannot run when the head is free", () => {
    expect(digOut.canRun(body().ctx)).toBe(false);
  });
});

describe("recoil and steady", () => {
  it("stop at once, step back to the given spot while sneaking, and let go of sneak afterwards", async () => {
    for (const skill of [recoil, steady]) {
      const b = body();
      const result = await skill.run(b.ctx, "pos:0.5,63,1.5", never);
      expect(result).toEqual({ status: "done", changes: { stopped: true, steppedBack: true } });
      expect(b.went[0]).toEqual(new Vec3(0.5, 63, 1.5));
      expect(b.log).toContain("path cleared");
      expect(b.keysDown()).toEqual([]);
    }
  });

  it("only stops, without stepping, when the spot behind is not safe to stand on", async () => {
    const b = body({ blocks: { "0,62,1": "lava" } });
    expect(await recoil.run(b.ctx, "pos:0.5,63,1.5", never)).toEqual({ status: "done", changes: { stopped: true, steppedBack: false } });
    expect(b.went).toEqual([]);
    expect(b.keysDown()).toEqual([]);
  });

  it("are reflex-only, like withdraw and dig_out", () => {
    expect([recoil, steady, withdraw, digOut].every((s) => s.reflexOnly)).toBe(true);
  });
});
