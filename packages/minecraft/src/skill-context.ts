import type { ItemWant } from "@familiar/contracts";
import type { Bot } from "mineflayer";
import type { Base } from "./base.js";
import type { ChestMemory } from "./chest-memory.js";
import type { Locomotion } from "./locomotion/index.js";

/** What every Minecraft skill gets to act with. */
export interface MinecraftCtx {
  bot: Bot;
  base: Base;
  /** What the current goal wants the bot to carry (decided by the planner). */
  wants(): readonly ItemWant[];
  /** The locomotion controller: everything that travels goes through it. */
  locomotion: Locomotion;
  /** What the bot remembers about the chests it has opened. */
  chests: ChestMemory;
  log: (msg: string) => void;
}
