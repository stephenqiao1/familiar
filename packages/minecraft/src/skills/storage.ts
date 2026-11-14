import type { ItemWant } from "@familiar/contracts";
import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { posId } from "../encode/scan-blocks.js";
import { CONTAINERS } from "../encode/scan-useful-blocks.js";
import type { Block } from "../mc-types.js";
import type { MinecraftCtx } from "../skill-context.js";
import { parseTarget } from "../target.js";

// Helpers shared by the storage skills (take_items, deposit_items).

/** What the goal wants that the bot doesn't carry yet. */
export function stillWanted(wants: readonly ItemWant[], carried: Record<string, number>): ItemWant[] {
  return wants.map((w) => ({ item: w.item, count: w.count - (carried[w.item] ?? 0) })).filter((w) => w.count > 0);
}

/** The container block at a "pos:x,y,z" target, or null if the target is not one. */
export function containerAt(bot: Bot, target: string): Block | null {
  const parsed = parseTarget(target);
  if (parsed?.kind !== "pos") return null;
  const block = bot.blockAt(new Vec3(parsed.x, parsed.y, parsed.z));
  return block && CONTAINERS.has(block.name) ? block : null;
}

/** The target's container, or with no target the base chest. */
export function chosenContainer(ctx: MinecraftCtx, target: string | undefined): Block | null {
  return containerAt(ctx.bot, target ?? posId(ctx.base.chest));
}
