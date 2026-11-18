import type { Choice } from "@familiar/region-brainstem";
import { Vec3 } from "vec3";
import { describe, expect, it } from "vitest";
import type { MinecraftCtx } from "../skill-context.js";
import { fakeBot } from "../primitives/fake-bot.test-helper.js";
import { attack } from "./attack.js";
import { flee } from "./flee.js";
import { freeze } from "./freeze.js";
import { recuperate } from "./recuperate.js";

const zombie = (x: number) => ({ id: 7, name: "zombie", type: "hostile", position: new Vec3(x + 0.5, 63, 0.5), height: 1.8, isValid: true });
const choice = (over: Partial<Choice>): Choice => ({ mode: "freeze", base: 0.5, why: "", target: "entity:7", threat: 0.5, flightDistance: 8, cornered: false, coming: 0, ...over });
/** A threat sense that says what the test tells it to. */
const threats = (now: () => Partial<Choice>, safe = 16): NonNullable<MinecraftCtx["threats"]> => ({ latest: () => ({ threats: [], possible: null, choice: choice(now()) }), safeDistance: () => safe });

describe("freeze", () => {
  it("is reflex-only and needs a threat to freeze for", () => {
    expect(freeze).toMatchObject({ name: "freeze", reflexOnly: true });
    expect(freeze.canRun(fakeBot().ctx, undefined)).toBe(false);
    expect(freeze.canRun(fakeBot({ entities: [zombie(8)] }).ctx, "entity:7")).toBe(true);
  });

  it("stops, holds sneak and watches the threat, and ends when the defence stops choosing to freeze", async () => {
    const bot = fakeBot({ entities: [zombie(8)] });
    let mode: Choice["mode"] = "freeze";
    const sneaking: boolean[] = [];
    const run = freeze.run({ ...bot.ctx, threats: threats(() => ({ mode })) }, "entity:7", new AbortController().signal);
    await new Promise((r) => setTimeout(r, 100));
    sneaking.push(bot.keysDown().includes("sneak"));
    expect(bot.log).toContain("path cleared");
    // Facing east, toward the zombie.
    expect(bot.state.entity.yaw).toBeCloseTo(-Math.PI / 2, 1);
    mode = "flee";
    const result = await run;
    expect(sneaking).toEqual([true]);
    expect(result).toMatchObject({ status: "done", changes: { ended: "the defence is now flee" } });
    expect(bot.keysDown()).not.toContain("sneak");
  });

  it("ends when the threat is gone, and lets go of sneak when interrupted", async () => {
    const gone = fakeBot({ entities: [zombie(8)] });
    const run = freeze.run({ ...gone.ctx, threats: threats(() => ({})) }, "entity:7", new AbortController().signal);
    delete (gone.state.entities as Record<number, unknown>)[7];
    expect(await run).toMatchObject({ status: "done", changes: { ended: "the threat is gone" } });

    const bot = fakeBot({ entities: [zombie(8)] });
    const stop = new AbortController();
    const held = freeze.run({ ...bot.ctx, threats: threats(() => ({})) }, "entity:7", stop.signal);
    await new Promise((r) => setTimeout(r, 50));
    stop.abort();
    expect((await held).status).toBe("interrupted");
    expect(bot.keysDown()).not.toContain("sneak");
  });
});

describe("flee", () => {
  it("runs until the threat's own safe distance (twice its flight distance), not a fixed 16", async () => {
    const bot = fakeBot({ entities: [zombie(10)] });
    (bot.state as unknown as { world: unknown }).world = { raycast: () => null };
    const asked: number[] = [];
    const locomotion = { ...bot.ctx.locomotion, awayFrom: async (_t: unknown, options: { distance: number }) => (asked.push(options.distance), { status: "done" as const }) } as unknown as MinecraftCtx["locomotion"];
    await flee.run({ ...bot.ctx, locomotion, threats: threats(() => ({}), 24) }, "entity:7", new AbortController().signal);
    await flee.run({ ...bot.ctx, locomotion }, "entity:7", new AbortController().signal);
    expect(asked).toEqual([24, 16]);
    // Ten blocks off is already safe from something whose safe distance is 8.
    expect(flee.canRun({ ...bot.ctx, threats: threats(() => ({}), 8) }, "entity:7")).toBe(false);
    expect(flee.canRun({ ...bot.ctx, threats: threats(() => ({}), 24) }, "entity:7")).toBe(true);
  });
});

describe("attack", () => {
  it("gives up at low health with a way out, and fights on when cornered", async () => {
    const free = fakeBot({ entities: [zombie(2)] });
    free.state.health = 4;
    expect(await attack.run({ ...free.ctx, threats: threats(() => ({ cornered: false })) }, "entity:7", new AbortController().signal)).toMatchObject({ status: "failed", reason: "low_health" });
    expect(free.log).not.toContain("attacked 7");

    const cornered = fakeBot({ entities: [zombie(2)] });
    cornered.state.health = 4;
    const stop = new AbortController();
    const fight = attack.run({ ...cornered.ctx, threats: threats(() => ({ cornered: true })) }, "entity:7", stop.signal);
    await new Promise((r) => setTimeout(r, 50));
    stop.abort();
    await fight;
    expect(cornered.log).toContain("attacked 7");
  });
});

describe("recuperate", () => {
  it("is reflex-only, and only for a body that is hurt", () => {
    expect(recuperate).toMatchObject({ name: "recuperate", reflexOnly: true });
    const bot = fakeBot();
    expect(recuperate.canRun(bot.ctx)).toBe(false);
    bot.state.health = 8;
    expect(recuperate.canRun(bot.ctx)).toBe(true);
  });

  it("goes home when home is near, then rests until mended", async () => {
    const bot = fakeBot();
    bot.state.health = 8;
    bot.state.entity.position = new Vec3(20.5, 63, 0.5);
    const went: unknown[] = [];
    const locomotion = { ...bot.ctx.locomotion, goTo: async (place: unknown) => (went.push(place), { status: "done" as const }) } as unknown as MinecraftCtx["locomotion"];
    const run = recuperate.run({ ...bot.ctx, locomotion }, undefined, new AbortController().signal);
    await new Promise((r) => setTimeout(r, 30));
    bot.state.health = 16;
    expect(await run).toMatchObject({ status: "done", changes: { healthFrom: 8, healthTo: 16, wentHome: true } });
    expect(went).toEqual([bot.ctx.base.chest]);
  });

  it("rests where it is when home is far, and stops when interrupted", async () => {
    const bot = fakeBot();
    bot.state.health = 8;
    bot.state.entity.position = new Vec3(200.5, 63, 0.5);
    const went: unknown[] = [];
    const locomotion = { ...bot.ctx.locomotion, goTo: async (place: unknown) => (went.push(place), { status: "done" as const }) } as unknown as MinecraftCtx["locomotion"];
    const stop = new AbortController();
    const run = recuperate.run({ ...bot.ctx, locomotion }, undefined, stop.signal);
    await new Promise((r) => setTimeout(r, 30));
    stop.abort();
    expect((await run).status).toBe("interrupted");
    expect(went).toEqual([]);
  });
});
