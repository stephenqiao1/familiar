import { describe, expect, it } from "vitest";
import { fakeBot } from "../primitives/fake-bot.test-helper.js";
import { flinch, FLINCH_MS } from "./flinch.js";

const signal = new AbortController().signal;

describe("flinch", () => {
  it("claims no part of the body and is reflex-only, so it runs beside whatever is under way", () => {
    expect(flinch).toMatchObject({ name: "flinch", reflexOnly: true, parts: [] });
  });

  it("pauses the journey for a moment (it does not stop it) and glances at the source", async () => {
    const bot = fakeBot();
    bot.setWalking(true);
    const started = Date.now();
    const result = await flinch.run(bot.ctx, "pos:5,64,0", signal);
    expect(Date.now() - started).toBeGreaterThanOrEqual(FLINCH_MS - 10);
    expect(Date.now() - started).toBeLessThan(400);
    expect(result).toEqual({ status: "done", changes: { froze: 150, journeyPaused: true } });
    expect(bot.log).toContain("paused 150");
    expect(bot.log).not.toContain("path cleared");
    // Facing east, toward the source.
    expect(bot.state.entity.yaw).toBeCloseTo(-Math.PI / 2, 1);
  });

  it("leaves the head alone while a dig is in progress, and needs no source at all", async () => {
    const bot = fakeBot();
    bot.state.targetDigBlock = {};
    await flinch.run(bot.ctx, "pos:5,64,0", signal);
    expect(bot.state.entity.yaw).toBe(0);
    expect((await flinch.run(fakeBot().ctx, undefined, signal)).status).toBe("done");
  });
});
