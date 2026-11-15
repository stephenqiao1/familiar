import type { Skill } from "@familiar/contracts";
import type { Bot } from "mineflayer";
import type { Entity } from "../mc-types.js";
import { nearestHostile } from "../mobs.js";
import type { MinecraftCtx } from "../skill-context.js";
import { entityOf, REACH, withinReach } from "./aim.js";

/** Swings once at something within reach, with whatever is in hand. */
export const hit: Skill<MinecraftCtx> = {
  name: "hit",
  description: "Swing once at an entity within reach (default: the nearest hostile).",
  primitive: true,
  risky: true,

  canRun(ctx, target) {
    return inReach(ctx.bot, target) !== null;
  },

  async run(ctx, target, signal) {
    const entity = inReach(ctx.bot, target);
    if (!entity) return { status: "failed", reason: "nothing within reach" };
    await ctx.bot.lookAt(entity.position.offset(0, entity.height * 0.8, 0), true);
    if (signal.aborted) return { status: "interrupted" };
    ctx.bot.attack(entity);
    return { status: "done" };
  },
};

function inReach(bot: Bot, target: string | undefined): Entity | null {
  const entity = target === undefined ? nearestHostile(bot, REACH) : entityOf(bot, target);
  return entity && withinReach(bot, entity.position.offset(0, entity.height * 0.5, 0)) ? entity : null;
}
