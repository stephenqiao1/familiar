import { describe, expect, it } from "vitest";
import { Vec3 } from "vec3";
import { postureCheck, unsteadyReason } from "./check.js";
import type { PostureView } from "./rules.js";
import { installPosture, postureOf } from "./runtime.js";
import { setKnownSurfaces } from "./surfaces.js";

const NOT_SOLID = new Set(["air", "water", "lava", "ladder", "vine"]);

/** A small world: the listed blocks by "x,y,z", stone at y <= `floor`, air above. The bot's feet are at `at`. */
function world(blocks: Record<string, string>, at: [number, number, number] = [0, 64, 0], floor = 63, props: Record<string, Record<string, unknown>> = {}): PostureView {
  return {
    entity: { position: new Vec3(at[0] + 0.5, at[1], at[2] + 0.5) },
    blockAt(pos: Vec3) {
      const key = `${pos.x},${pos.y},${pos.z}`;
      const name = blocks[key] ?? (pos.y <= floor ? "stone" : "air");
      return { name, boundingBox: NOT_SOLID.has(name) ? "empty" : "block", getProperties: () => props[key] ?? {} };
    },
  };
}
const column = (x: number, z: number, from: number, to: number, name: string) => Object.fromEntries(Array.from({ length: to - from + 1 }, (_, i) => [`${x},${from + i},${z}`, name]));
const dig = (x: number, y: number, z: number) => ({ kind: "break" as const, at: new Vec3(x, y, z) });

describe("unsteadyReason: breaking", () => {
  it("refuses digging underfoot over a 5-block drop, and allows it over a 1-block drop", () => {
    // A pillar: the bot stands on 0,63,0 with air from y=58 to 62 under it.
    expect(unsteadyReason(world(column(0, 0, 58, 62, "air")), dig(0, 63, 0))).toBe("would drop me 3 blocks or more");
    expect(unsteadyReason(world({}), dig(0, 63, 0))).toBeNull();
    expect(unsteadyReason(world({ "0,62,0": "air" }), dig(0, 63, 0))).toBeNull();
  });

  it("refuses digging underfoot onto something that hurts", () => {
    expect(unsteadyReason(world({ "0,62,0": "magma_block" }), dig(0, 63, 0))).toBe("would drop me onto magma_block");
  });

  it("refuses a block with lava or water against it", () => {
    expect(unsteadyReason(world({ "3,64,0": "stone", "3,65,0": "lava" }), dig(3, 64, 0))).toBe("would let lava in");
    expect(unsteadyReason(world({ "3,64,0": "stone", "4,64,0": "water" }), dig(3, 64, 0))).toBe("would let water in");
  });

  it("refuses digging under a gravel column at head height, and allows a wall with solid stone above", () => {
    const gravel = { "1,65,0": "stone", ...column(1, 0, 66, 68, "gravel") };
    expect(unsteadyReason(world(gravel), dig(1, 65, 0))).toBe("would bring the gravel down beside my head");
    expect(unsteadyReason(world({ "1,65,0": "stone", "1,66,0": "stone" }), dig(1, 65, 0))).toBeNull();
  });

  it("refuses digging the roof out from under a sand column above the head", () => {
    const roof = { "0,66,0": "stone", "0,67,0": "sand", "0,68,0": "sand" };
    expect(unsteadyReason(world(roof), dig(0, 66, 0))).toBe("would bring the sand down on me");
  });

  it("allows a loose block that would come down out of the body's way, and one the bot does not know is loose", () => {
    // Gravel above a block at foot height, two blocks off: it lands where the block was.
    expect(unsteadyReason(world({ "2,64,0": "stone", "2,65,0": "gravel" }), dig(2, 64, 0))).toBeNull();
    const bot = world({ "0,66,0": "stone", "0,67,0": "sand" });
    setKnownSurfaces(bot, () => null);
    expect(unsteadyReason(bot, dig(0, 66, 0))).toBeNull();
  });

  it("already buried, digging the block the head is in is allowed whatever is above", () => {
    expect(unsteadyReason(world({ "0,65,0": "gravel", "0,66,0": "gravel" }), dig(0, 65, 0))).toBeNull();
  });

  it("refuses breaking the ladder being climbed, and the block it hangs from", () => {
    const blocks = { "0,64,0": "ladder", "0,65,0": "ladder", ...column(0, 1, 60, 70, "stone") };
    // The ladder faces north (-z), so it hangs from the block to the south.
    const props = { "0,64,0": { facing: "north" }, "0,65,0": { facing: "north" } };
    const bot = world(blocks, [0, 64, 0], 63, props);
    expect(unsteadyReason(bot, dig(0, 64, 0))).toBe("would break the ladder I am climbing");
    expect(unsteadyReason(bot, dig(0, 64, 1))).toBe("would break what the ladder I am climbing hangs from");
    expect(unsteadyReason(bot, dig(0, 62, 1))).toBeNull();
  });

  it("standing on a loose block, refuses taking away what it rests on", () => {
    const bot = world({ "0,63,0": "sand" });
    expect(unsteadyReason(bot, dig(0, 62, 0))).toBe("would take away what the sand under me rests on");
  });

  it("planning a route, refuses a block with something loose above it, wherever the body is", () => {
    const bot = world({ "9,64,0": "stone", "9,65,0": "gravel" });
    expect(unsteadyReason(bot, { ...dig(9, 64, 0), planned: true })).toBe("would bring the gravel above it down");
    expect(unsteadyReason(bot, dig(9, 64, 0))).toBeNull();
  });
});

describe("unsteadyReason: placing and moving", () => {
  it("refuses setting a loose block where it would fall onto the body", () => {
    const bot = world({ "0,67,0": "stone" });
    expect(unsteadyReason(bot, { kind: "place", at: new Vec3(0, 66, 0), item: "sand" })).toBe("would bring the sand down on me");
    expect(unsteadyReason(bot, { kind: "place", at: new Vec3(0, 66, 0), item: "stone" })).toBeNull();
    expect(unsteadyReason(bot, { kind: "place", at: new Vec3(2, 64, 0), item: "sand" })).toBeNull();
  });

  it("refuses a step onto nothing, and one with no headroom; allows a step up or down one", () => {
    const cliff = world(column(1, 0, 55, 63, "air"));
    expect(unsteadyReason(cliff, { kind: "move", to: new Vec3(1, 64, 0) })).toBe("nothing to stand on there");
    expect(unsteadyReason(world({ "1,65,0": "stone" }), { kind: "move", to: new Vec3(1, 64, 0) })).toBe("not enough headroom there");
    expect(unsteadyReason(world({ "1,64,0": "stone" }), { kind: "move", to: new Vec3(1, 64, 0) })).toBeNull();
    expect(unsteadyReason(world({ "1,63,0": "air" }), { kind: "move", to: new Vec3(1, 64, 0) })).toBeNull();
  });
});

describe("postureCheck", () => {
  it("says so when one step to the side would make the same dig safe", () => {
    // On a pillar with solid ground beside it: the block underfoot can be dug from the side.
    const bot = world({ ...column(0, 0, 58, 62, "air") });
    expect(postureCheck(bot, "break_block", dig(0, 63, 0))).toBe("unsafe from here (would drop me 3 blocks or more): stand to the side");
    // A lone pillar has no side to stand on.
    const alone = world({ "0,63,0": "stone" }, [0, 64, 0], 55);
    expect(postureCheck(alone, "break_block", dig(0, 63, 0))).toBe("would drop me 3 blocks or more");
  });

  it("notes each refusal, and says clearly when the same one comes three times in a minute", () => {
    const bot = world(column(0, 0, 58, 62, "air"), [0, 64, 0], 55);
    const logged: string[] = [];
    const posture = installPosture(bot, { check: 1, stance: 1 }, (msg) => logged.push(msg));
    for (let i = 0; i < 3; i++) postureCheck(bot, "break_block", dig(0, 63, 0));
    const notes = posture.take();
    expect(notes.refusals).toHaveLength(3);
    expect(notes.refusals![0]).toEqual({ action: "break_block", at: "0,63,0", reason: "would drop me 3 blocks or more" });
    expect(notes.repeated).toHaveLength(1);
    expect(logged.join("\n")).toContain("three times in a minute");
    expect(posture.take()).toEqual({});
  });

  it("is cheap, and measures itself", () => {
    const bot = world({ "1,65,0": "stone", ...column(1, 0, 66, 68, "gravel") });
    for (let i = 0; i < 100; i++) postureCheck(bot, "break_block", dig(1, 65, 0)); // warm up
    const started = performance.now();
    for (let i = 0; i < 500; i++) postureCheck(bot, "break_block", dig(1, 65, 0));
    // The limit is 2 ms a check; on average it should be far under (one slow first call aside).
    expect((performance.now() - started) / 500).toBeLessThan(0.5);
    expect(postureOf(bot).take().worstCheckMs).toBeGreaterThan(0);
  });

  it("refuses nothing with the check switched off", () => {
    const bot = world(column(0, 0, 58, 62, "air"));
    installPosture(bot, { check: 0, stance: 1 }, () => {});
    expect(postureCheck(bot, "break_block", dig(0, 63, 0))).toBeNull();
  });

  it("never changes the world or moves the bot", () => {
    const bot = world(column(0, 0, 58, 62, "air"));
    const before = bot.entity.position.clone();
    expect(Object.keys(bot).sort()).toEqual(["blockAt", "entity"]); // nothing to act with
    postureCheck(bot, "break_block", dig(0, 63, 0));
    expect(bot.entity.position).toEqual(before);
  });
});
