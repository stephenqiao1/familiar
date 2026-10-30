import type { Bot } from "mineflayer";
import type { Base } from "./base.js";

/** What every Minecraft skill gets to act with. */
export interface MinecraftCtx {
  bot: Bot;
  base: Base;
  log: (msg: string) => void;
}
