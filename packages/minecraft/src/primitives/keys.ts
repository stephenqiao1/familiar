import type { Bot } from "mineflayer";

/** A movement key. */
export type Key = "forward" | "back" | "left" | "right" | "jump" | "sprint" | "sneak";

/** Presses or lets go of one movement key. */
export function holdKey(bot: Bot, key: Key, down: boolean): void {
  bot.setControlState(key, down);
}

/** Lets go of every movement key. */
export function releaseKeys(bot: Bot): void {
  bot.clearControlStates();
}
