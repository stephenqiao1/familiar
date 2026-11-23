import type { Bot } from "mineflayer";

/** Game minutes per game tick: a day is 24 000 ticks and 1440 minutes. */
const MINUTES_PER_TICK = 1440 / 24_000;

/** Keeps track of how long it has been since the bot last slept, on the world's own clock. */
export interface SleepClock {
  /** Game minutes since the bot last woke from sleep. */
  sinceSleepMinutes(): number;
  /** The world's age (in ticks) when it last woke, for saving. */
  sleptAtAge(): number;
}

/** The game counts a night as slept through after this long in bed; getting out sooner is not a sleep. */
export const REAL_SLEEP_TICKS = 100;

/**
 * Starts the clock from the saved waking time (`sleptAtAge`, the world's age in ticks), so the
 * count survives a restart; with nothing saved it starts now. Only waking from a real sleep
 * resets it: lying down for a moment, or being thrown out of bed, leaves the bot as tired as it was.
 */
export function createSleepClock(bot: Pick<Bot, "on"> & { time: { age: number } }, sleptAtAge?: number): SleepClock {
  const age = () => Number(bot.time.age) || 0;
  // A saved time from another world (later than now) is ignored.
  let slept = sleptAtAge !== undefined && sleptAtAge <= age() ? sleptAtAge : age();
  let inBedSince: number | null = null;
  bot.on("sleep", () => {
    inBedSince = age();
  });
  bot.on("wake", () => {
    if (inBedSince !== null && age() - inBedSince >= REAL_SLEEP_TICKS) slept = age();
    inBedSince = null;
  });
  return {
    sinceSleepMinutes: () => Math.max(0, Math.round((age() - slept) * MINUTES_PER_TICK)),
    sleptAtAge: () => slept,
  };
}
