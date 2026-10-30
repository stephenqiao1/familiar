import type { Bot } from "mineflayer";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { encodeState, type EncodableBot } from "./encode-state.js";

function fakeBot(isDay: boolean): EncodableBot {
  return {
    health: 18,
    food: 15,
    entity: { position: { x: 1.5, y: 64, z: -3.25 } },
    time: { isDay },
  };
}

describe("encodeState", () => {
  afterEach(() => vi.useRealTimers());

  it("encodes health, food, position and isNight", () => {
    vi.useFakeTimers({ now: 1234 });
    expect(encodeState(fakeBot(true), 7)).toEqual({
      schemaVersion: 1,
      tick: 7,
      timestamp: 1234,
      data: { health: 18, food: 15, position: { x: 1.5, y: 64, z: -3.25 }, isNight: false },
    });
  });

  it("reports night when it is not day", () => {
    expect(encodeState(fakeBot(false), 0).data.isNight).toBe(true);
  });

  it("copies position into a plain object", () => {
    const bot = fakeBot(true);
    const { position } = encodeState(bot, 0).data;
    expect(position).not.toBe(bot.entity.position);
  });
});

describe("EncodableBot", () => {
  it("is satisfied by a real mineflayer Bot", () => {
    expectTypeOf<Bot>().toExtend<EncodableBot>();
  });
});
