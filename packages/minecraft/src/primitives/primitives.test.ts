import type { Skill } from "@familiar/contracts";
import { installPosture } from "../posture/runtime.js";
import { describe, expect, it } from "vitest";
import type { MinecraftCtx } from "../skill-context.js";
import { entity, fakeBot, item, type FakeOptions } from "./fake-bot.test-helper.js";
import { primitives } from "./index.js";

const never = new AbortController().signal;
const named = (name: string): Skill<MinecraftCtx> => primitives.find((p) => p.name === name)!;
const run = (bot: ReturnType<typeof fakeBot>, name: string, target?: string, signal = never) => named(name).run(bot.ctx, target, signal);
/** Starts a primitive and stops it after `ms`. */
async function stopAfter(bot: ReturnType<typeof fakeBot>, name: string, target: string | undefined, ms: number) {
  const controller = new AbortController();
  const running = run(bot, name, target, controller.signal);
  await new Promise((resolve) => setTimeout(resolve, ms));
  controller.abort(new Error("interrupted"));
  return running;
}

describe("the primitives", () => {
  it("are the full set, each naming the body parts it uses", () => {
    expect(primitives.map((p) => p.name)).toEqual([
      "look_at", "turn",
      "step", "step_toward", "jump", "sneak", "brace", "pick_up",
      "equip", "drop_item", "use_item", "use_on", "hit", "break_block", "place_block", "open", "move_item", "close", "craft",
    ]);
    for (const p of primitives) {
      expect(p.primitive, p.name).toBe(true);
      expect(p.parts?.length, p.name).toBeGreaterThan(0);
    }
    expect(primitives.filter((p) => p.long).map((p) => p.name)).toEqual(["break_block"]);
    expect(primitives.filter((p) => p.parts?.join() === "head").map((p) => p.name)).toEqual(["look_at", "turn"]);
  });

  it("each refuses when it cannot run, and fails cleanly with a reason if run anyway", async () => {
    // An empty-handed bot on bare stone, looking at nothing, with nothing nearby.
    const cannot: [string, string | undefined][] = [
      ["look_at", "entity:99"], ["turn", "dir:forward"], ["step", "dir:up"], ["step_toward", "entity:99"], ["pick_up", undefined],
      ["equip", undefined], ["equip", "item:bread"], ["drop_item", undefined], ["use_item", undefined], ["use_on", undefined], ["hit", undefined],
      ["break_block", undefined], ["break_block", "dir:forward"], ["place_block", undefined], ["open", undefined], ["move_item", "item:bread:in"],
      ["close", undefined], ["craft", "item:oak_planks"],
    ];
    for (const [name, target] of cannot) {
      const bot = fakeBot();
      expect(named(name).canRun(bot.ctx, target), `${name} ${target}`).toBe(false);
      const result = await run(bot, name, target);
      expect(result.status, `${name} ${target}`).toBe("failed");
      expect(result.reason, `${name} ${target}`).toEqual(expect.any(String));
      expect(result.changes, `${name} ${target}`).toEqual({ asExpected: false });
      expect(bot.keysDown(), name).toEqual([]);
    }
  });

  it("break_block refuses a protected block", () => {
    const chest = fakeBot({ blocks: { "0,63,-1": "chest" } });
    expect(named("break_block").canRun(chest.ctx, "dir:forward")).toBe(false);
  });

  describe("the check before acting", () => {
    const run = (bot: ReturnType<typeof fakeBot>, name: string, target?: string) => named(name).run(bot.ctx, target, new AbortController().signal);

    it("step fails with the reason when it would walk into lava or off a drop, and holds no key", async () => {
      const lava = fakeBot({ blocks: { "0,63,-1": "lava" } });
      expect(await run(lava, "step", "dir:forward")).toMatchObject({ status: "failed", reason: "nowhere safe to stand there" });
      const cliff = fakeBot({ blocks: { "0,62,-1": "air", "0,61,-1": "air", "0,60,-1": "air" } });
      expect(await run(cliff, "step", "dir:forward")).toMatchObject({ status: "failed", reason: "nothing to stand on there", changes: { asExpected: false } });
      expect(cliff.keysDown()).toEqual([]);
      expect(cliff.state.entity.position.z).toBe(0.5);
    });

    it("break_block fails with the reason when the dig would drop the bot, and digs nothing", async () => {
      const pillar = fakeBot({ blocks: { "0,61,0": "air", "0,60,0": "air", "0,59,0": "air" } });
      const result = await run(pillar, "break_block", "pos:0,62,0");
      expect(result).toMatchObject({ status: "failed", reason: "unsafe from here (would drop me 3 blocks or more): stand to the side" });
      expect(pillar.blockName(0, 62, 0)).toBe("stone");
    });

    it("break_block fails with the reason under a gravel column at head height, and goes ahead under stone", async () => {
      const gravel = fakeBot({ blocks: { "0,64,-1": "stone", "0,65,-1": "gravel", "0,66,-1": "gravel" } });
      expect(await run(gravel, "break_block", "pos:0,64,-1")).toMatchObject({ status: "failed", reason: "unsafe from here (would bring the gravel down beside my head): stand to the side" });
      const stone = fakeBot({ blocks: { "0,64,-1": "stone", "0,65,-1": "stone" } });
      expect(await run(stone, "break_block", "pos:0,64,-1")).toMatchObject({ status: "done" });
    });

    describe("stance", () => {
      /** A drop of 5 just in front (north) of where the bot stands. */
      const edge = () => fakeBot({ blocks: { "0,62,-1": "air", "0,61,-1": "air", "0,60,-1": "air", "0,59,-1": "air", "0,64,1": "stone" }, digMs: 60 });

      it("holds sneak during a hands-only action at an edge, and lets go after", async () => {
        const bot = edge();
        const running = run(bot, "break_block", "pos:0,64,1");
        await new Promise((r) => setTimeout(r, 20));
        expect(bot.keysDown()).toEqual(["sneak"]);
        const result = await running;
        expect(result).toMatchObject({ status: "done", changes: { stance: true } });
        expect(result.changes?.sneaking).toBeUndefined();
        expect(bot.keysDown()).toEqual([]);
      });

      it("lets go at once when the action is stopped (a hard reflex taking over)", async () => {
        const bot = edge();
        const stop = new AbortController();
        const running = named("break_block").run(bot.ctx, "pos:0,64,1", stop.signal);
        await new Promise((r) => setTimeout(r, 20));
        expect(bot.keysDown()).toEqual(["sneak"]);
        stop.abort();
        expect(bot.keysDown()).toEqual([]);
        expect((await running).status).toBe("interrupted");
      });

      it("is not held on open ground, for an action that uses the legs, or when sneaking would change the action", async () => {
        const open = fakeBot({ blocks: { "0,64,1": "stone" }, digMs: 60 });
        const digging = run(open, "break_block", "pos:0,64,1");
        await new Promise((r) => setTimeout(r, 20));
        expect(open.keysDown()).toEqual([]);
        expect((await digging).changes?.stance).toBeUndefined();

        const bot = fakeBot({ blocks: { "0,62,-1": "air", "0,61,-1": "air", "0,60,-1": "air" } });
        const stepping = run(bot, "step", "dir:back");
        await new Promise((r) => setTimeout(r, 20));
        expect(bot.keysDown()).toEqual(["back"]);
        bot.state.entity.position.z += 1;
        await stepping;

        const chest = fakeBot({ blocks: { "0,62,-1": "air", "0,61,-1": "air", "0,60,-1": "air", "0,63,1": "chest" } });
        expect((await run(chest, "open", "pos:0,63,1")).changes?.stance).toBeUndefined();
      });

      it("is not held with the stance switched off", async () => {
        const bot = edge();
        installPosture(bot.bot, { check: 1, stance: 0 }, () => {});
        expect((await run(bot, "break_block", "pos:0,64,1")).changes?.stance).toBeUndefined();
      });
    });

    it("a moving jump that would come down over a drop fails with the reason; a standing jump goes ahead", async () => {
      const cliff = fakeBot({ blocks: { "0,62,-1": "air", "0,61,-1": "air", "0,60,-1": "air" } });
      expect(await run(cliff, "jump")).toMatchObject({ status: "done" });
      cliff.state.entity.velocity.set(0, 0, -0.1);
      expect(await run(cliff, "jump")).toMatchObject({ status: "failed", reason: "nothing to stand on there" });
    });
  });

  describe("when they work", () => {
    const cases: [string, string | undefined, FakeOptions, Record<string, unknown>][] = [
      ["turn", "dir:left", {}, { turned: 45 }],
      ["sneak", undefined, {}, { sneaking: true }],
      ["equip", "item:stone_sword", { items: [item("bread"), item("stone_sword")], held: "bread" }, { held: "stone_sword" }],
      ["equip", undefined, { items: [item("bread"), item("stone_sword")], held: "bread" }, { held: "stone_sword" }],
      ["drop_item", undefined, { items: [item("bread", 3)], held: "bread" }, { lost: { bread: 1 }, drops: 1 }],
      ["drop_item", "held", { items: [item("bread", 3)], held: "bread" }, { lost: { bread: 3 }, held: "nothing", drops: 1 }],
      ["break_block", "dir:forward", { blocks: { "0,63,-1": "dirt" } }, { targetBlockWas: "dirt", targetBlock: "air", progress: 1 }],
      ["place_block", "dir:forward", { items: [item("dirt", 2)], held: "dirt" }, { turned: expect.any(Number), lost: { dirt: 1 }, targetBlockWas: "air", targetBlock: "dirt" }],
      ["hit", "entity:9", { entities: [entity(9, "zombie", 0, -1)] }, { turned: expect.any(Number), targetHurt: true }],
      ["open", "dir:forward", { blocks: { "0,63,-1": "chest" } }, { opened: "chest" }],
      ["craft", "item:oak_planks", { items: [item("oak_log")], recipes: { oak_planks: { uses: { oak_log: 1 }, makes: 4 } } }, { gained: { oak_planks: 4 }, lost: { oak_log: 1 } }],
      ["craft", "item:wooden_pickaxe", { blocks: { "1,63,0": "crafting_table" }, items: [item("oak_planks", 3), item("stick", 2)], recipes: { wooden_pickaxe: { uses: { oak_planks: 3, stick: 2 }, makes: 1, table: true } } }, { gained: { wooden_pickaxe: 1 }, lost: { oak_planks: 3, stick: 2 } }],
    ];
    it.each(cases)("%s %s reports what changed, as expected", async (name, target, options, changes) => {
      const bot = fakeBot(options);
      expect(named(name).canRun(bot.ctx, target)).toBe(true);
      expect(await run(bot, name, target)).toEqual({ status: "done", changes: { ...changes, asExpected: true } });
    });

    it("craft needs the table within reach for a recipe that needs one", () => {
      const bot = fakeBot({ items: [item("oak_planks", 3), item("stick", 2)], recipes: { wooden_pickaxe: { uses: { oak_planks: 3, stick: 2 }, makes: 1, table: true } } });
      expect(named("craft").canRun(bot.ctx, "item:wooden_pickaxe")).toBe(false);
    });

    it("use_on uses a door, an animal, or a bed", async () => {
      const bot = fakeBot({ blocks: { "0,63,-1": "oak_door", "1,63,0": "red_bed" }, entities: [entity(4, "cow", -1, 0, "animal")] });
      for (const target of ["dir:forward", "entity:4", "pos:1,63,0"]) expect((await run(bot, "use_on", target)).status).toBe("done");
      expect(bot.log.filter((l) => /used on|bed/.test(l))).toEqual(["used on oak_door", "used on entity 4", "got into bed"]);
    });

    it("use_on a crafting table does not leave its window open", async () => {
      const bot = fakeBot({ blocks: { "0,63,-1": "crafting_table" } });
      await run(bot, "use_on", "dir:forward");
      expect(bot.state.currentWindow).toBeNull();
    });

    it("open, move_item and close move an item into a chest and back out", async () => {
      const bot = fakeBot({ blocks: { "0,63,-1": "chest" }, items: [item("bread", 3)], held: "bread", chest: [item("stick", 2)] });
      await run(bot, "open", "dir:forward");
      expect(await run(bot, "move_item", "held")).toMatchObject({ status: "done", changes: { lost: { bread: 3 } } });
      expect(await run(bot, "move_item", "item:stick:out")).toMatchObject({ status: "done", changes: { gained: { stick: 2 } } });
      expect([bot.carried(), bot.stored()]).toEqual([{ stick: 2 }, { bread: 3 }]);
      expect(await run(bot, "close")).toEqual({ status: "done", changes: { closed: "chest", asExpected: true } });
      expect(bot.state.currentWindow).toBeNull();
    });

    it("a container left open is closed by the next primitive that does not use one", async () => {
      const bot = fakeBot({ blocks: { "0,63,-1": "chest" } });
      await run(bot, "open", "dir:forward");
      expect(bot.state.currentWindow).not.toBeNull();
      await run(bot, "jump");
      expect(bot.state.currentWindow).toBeNull();
    });

    it("use_item holds until the item is used up, then lets go", async () => {
      const bot = fakeBot({ items: [item("bread", 2)], held: "bread" });
      setTimeout(() => {
        bot.state.heldItem!.count = 1; // eaten
        bot.state.food = 20;
      }, 120);
      const result = await run(bot, "use_item");
      expect(result.status).toBe("done");
      expect(result.reason).toBeUndefined();
      expect(bot.state.using).toBe(false);
    });
  });

  describe("stopped mid-way", () => {
    it("step lets go of its key", async () => {
      const bot = fakeBot();
      const result = await stopAfter(bot, "step", "dir:forward", 60);
      expect(result.status).toBe("interrupted");
      expect(bot.keysDown()).toEqual([]);
    });

    it("step lets go of its key when its time is up, too", async () => {
      const bot = fakeBot(); // the fake never moves, so the step runs out of time
      expect((await run(bot, "step", "dir:forward")).changes).toEqual({ asExpected: false });
      expect(bot.keysDown()).toEqual([]);
    });

    it("jump lets go of jump", async () => {
      const bot = fakeBot();
      expect((await stopAfter(bot, "jump", undefined, 40)).status).toBe("interrupted");
      expect(bot.keysDown()).toEqual([]);
    });

    it("use_item lets go of the item", async () => {
      const bot = fakeBot({ items: [item("bow")], held: "bow" });
      expect((await stopAfter(bot, "use_item", undefined, 80)).status).toBe("interrupted");
      expect(bot.state.using).toBe(false);
    });

    it("break_block stops digging and reports how far it got", async () => {
      const bot = fakeBot({ blocks: { "0,63,-1": "dirt" }, digMs: 400 });
      const result = await stopAfter(bot, "break_block", "dir:forward", 100);
      expect(result.status).toBe("interrupted");
      expect(result.changes?.progress).toBeGreaterThan(0.1);
      expect(result.changes?.progress).toBeLessThan(0.9);
      expect(result.changes?.asExpected).toBe(false);
      expect(bot.log).toContain("stopped digging");
      expect(bot.state.targetDigBlock).toBeNull();
      expect(bot.blockName(0, 63, -1)).toBe("dirt");
    });

    it("brace drops the path and every key", async () => {
      const bot = fakeBot();
      bot.bot.setControlState("forward", true);
      bot.bot.setControlState("sneak", true);
      await run(bot, "brace");
      expect(bot.keysDown()).toEqual([]);
      expect(bot.log).toContain("path cleared");
    });
  });
});
