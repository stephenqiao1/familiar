import type { Skill } from "@familiar/contracts";
import type { Bot } from "mineflayer";
import pathfinder from "mineflayer-pathfinder";
import { sleepFor } from "../abort.js";
import type { Entity } from "../mc-types.js";
import { isStillThere, resolveMobTarget } from "../mobs.js";
import type { MinecraftCtx } from "../skill-context.js";
import { bestWeapon } from "../weapons.js";

const { GoalFollow } = pathfinder.goals;
const MAX_DISTANCE = 16;
const REACH = 3;
const LOW_HEALTH = 6;
const SWING_MS = 650; // just over a sword's attack cooldown

/** Fights a mob until it dies, escapes past 16 blocks, or the bot's health gets low. */
export const attack: Skill<MinecraftCtx> = {
  name: "attack",
  description: "Fight a mob (default: the nearest hostile) with the best weapon available.",

  canRun(ctx, target) {
    return resolveMobTarget(ctx.bot, target, MAX_DISTANCE) !== null;
  },

  async run(ctx, target, signal) {
    const { bot } = ctx;
    const mob = resolveMobTarget(bot, target, MAX_DISTANCE);
    if (!mob) return { status: "failed", reason: "no target" };

    const weapon = bestWeapon(bot);
    if (weapon) await bot.equip(weapon, "hand");
    ctx.log(`attack: fighting ${mob.name ?? "entity"} ${mob.id} with ${weapon?.name ?? "bare hands"}`);

    try {
      while (true) {
        if (!isStillThere(bot, mob)) return { status: "done" };
        if (bot.health < LOW_HEALTH) return { status: "failed", reason: "low_health" };
        const distance = distanceTo(bot, mob);
        if (distance > MAX_DISTANCE) return { status: "failed", reason: "target out of range" };

        if (distance > REACH) {
          bot.pathfinder.setGoal(new GoalFollow(mob, REACH - 1), true);
        } else {
          bot.pathfinder.setGoal(null);
          await bot.lookAt(mob.position.offset(0, mob.height * 0.8, 0), true);
          bot.attack(mob);
        }
        await sleepFor(SWING_MS, signal);
      }
    } catch (error) {
      if (signal.aborted) return { status: "interrupted" };
      throw error;
    } finally {
      bot.pathfinder.setGoal(null);
    }
  },
};

function distanceTo(bot: Bot, mob: Entity): number {
  return mob.position.distanceTo(bot.entity.position);
}
