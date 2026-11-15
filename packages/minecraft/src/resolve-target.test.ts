import { describe, expect, it } from "vitest";
import { Vec3 } from "vec3";
import { neighbour, stepOf } from "./facing.js";
import { entity, fakeBot, item } from "./primitives/fake-bot.test-helper.js";
import { resolveTarget } from "./resolve-target.js";
import { parseTarget } from "./target.js";

const resolve = (bot: ReturnType<typeof fakeBot>["bot"], target: string) => resolveTarget(bot, parseTarget(target)!);

describe("targets that need no names", () => {
  it("ahead: the block or entity the bot is looking at, within reach", () => {
    const { bot, lookingAt } = fakeBot();
    expect(resolve(bot, "ahead")).toBeNull(); // looking at nothing in reach
    lookingAt({ block: [0, 63, -2] });
    expect(resolve(bot, "ahead")).toMatchObject({ kind: "block", block: { position: new Vec3(0, 63, -2) } });
    const zombie = entity(9, "zombie", 0, -1);
    lookingAt({ block: [0, 63, -3], entity: zombie });
    expect(resolve(bot, "ahead")).toEqual({ kind: "entity", entity: zombie }); // the nearer thing
  });

  it("dir:<direction>: the neighbouring block, relative to where the bot faces", () => {
    const { bot, state } = fakeBot({ blocks: { "0,63,-1": "dirt", "1,63,0": "oak_log" } });
    // Facing north (-z): forward is -z, right is +x.
    expect(resolve(bot, "dir:forward")).toMatchObject({ kind: "block", block: { name: "dirt" } });
    expect(resolve(bot, "dir:right")).toMatchObject({ kind: "block", block: { name: "oak_log" } });
    expect(resolve(bot, "dir:left")).toEqual({ kind: "position", position: new Vec3(-1, 63, 0) }); // empty space is a position
    expect(resolve(bot, "dir:down")).toMatchObject({ kind: "block", block: { position: new Vec3(0, 62, 0) } });
    expect(resolve(bot, "dir:up")).toEqual({ kind: "position", position: new Vec3(0, 65, 0) });
    // Turn to face east (+x): forward is now the log.
    state.entity.yaw = -Math.PI / 2;
    expect(resolve(bot, "dir:forward")).toMatchObject({ kind: "block", block: { name: "oak_log" } });
  });

  it("held: the item in hand, or nothing with an empty hand", () => {
    expect(resolve(fakeBot().bot, "held")).toBeNull();
    expect(resolve(fakeBot({ items: [item("bread", 3)], held: "bread" }).bot, "held")).toEqual({ kind: "item", name: "bread" });
  });

  it("item:<name>: a real item by name, carried or not", () => {
    const { bot } = fakeBot();
    expect(resolve(bot, "item:oak_planks")).toEqual({ kind: "item", name: "oak_planks" });
    expect(resolveTarget(bot, { kind: "item", name: "unobtainium" })).toBeNull();
  });
});

describe("facing", () => {
  it("steps along the compass direction the bot faces most nearly", () => {
    expect(stepOf(0, "forward")).toEqual(new Vec3(0, 0, -1));
    expect(stepOf(0.3, "forward")).toEqual(new Vec3(0, 0, -1)); // still mostly north
    expect(stepOf(Math.PI / 2, "forward")).toEqual(new Vec3(-1, 0, 0)); // west
    expect(stepOf(0, "back")).toEqual(new Vec3(0, 0, 1));
    expect(stepOf(0, "left")).toEqual(new Vec3(-1, 0, 0));
    expect(stepOf(0, "right")).toEqual(new Vec3(1, 0, 0));
    expect(neighbour({ position: new Vec3(0.5, 63, 0.5), yaw: 0 }, "up")).toEqual(new Vec3(0, 65, 0));
  });
});
