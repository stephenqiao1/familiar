import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createSleepClock } from "./sleep-clock.js";

/** A stand-in bot: just the world's clock and the "wake" event. */
function sleeper(age: number) {
  const events = new EventEmitter();
  const bot = { time: { age }, on: (name: string, fn: () => void) => events.on(name, fn) } as never as Parameters<typeof createSleepClock>[0] & { time: { age: number } };
  return { bot, wake: () => events.emit("wake") };
}

describe("createSleepClock", () => {
  it("counts game minutes since the bot last woke: a day is 24 000 ticks and 1440 minutes", () => {
    const { bot } = sleeper(100_000);
    const clock = createSleepClock(bot);
    expect(clock.sinceSleepMinutes()).toBe(0);
    bot.time.age += 24_000;
    expect(clock.sinceSleepMinutes()).toBe(1440);
  });

  it("resets when the bot wakes from sleep", () => {
    const { bot, wake } = sleeper(100_000);
    const clock = createSleepClock(bot);
    bot.time.age += 30_000;
    wake();
    expect(clock.sinceSleepMinutes()).toBe(0);
    bot.time.age += 1000;
    expect(clock.sinceSleepMinutes()).toBe(60);
  });

  it("survives a restart: it carries on from the saved waking time", () => {
    const first = sleeper(100_000);
    const clock = createSleepClock(first.bot);
    first.bot.time.age += 12_000;
    const saved = clock.sleptAtAge();
    // The bot restarts some time later; the world's clock has moved on.
    const second = sleeper(118_000);
    expect(createSleepClock(second.bot, saved).sinceSleepMinutes()).toBe(1080);
  });

  it("ignores a saved time from another world (later than now)", () => {
    expect(createSleepClock(sleeper(5000).bot, 900_000).sinceSleepMinutes()).toBe(0);
  });
});
