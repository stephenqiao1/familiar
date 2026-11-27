import type { Skill } from "@familiar/contracts";
import type { Bot } from "mineflayer";
import { sleepFor } from "../abort.js";
import type { Entity } from "../mc-types.js";
import { isStillThere, resolveMobTarget } from "../mobs.js";
import { doEquip } from "../primitives/equip.js";
import { doHit } from "../primitives/hit.js";
import { watched } from "../primitives/watch.js";
import type { MinecraftCtx } from "../skill-context.js";
import { bestWeapon } from "../weapons.js";

const MAX_DISTANCE = 16;
const REACH = 3;
const LOW_HEALTH = 6;
const SWING_MS = 650; // just over a sword's attack cooldown

/** Fights a mob until it dies, escapes past 16 blocks, or the bot's health gets low (cornered, it fights on: there is nowhere to go). */
export const attack: Skill<MinecraftCtx> = {
  name: "attack",
  risky: true,
  demanding: true,
  description: "Fight a mob (default: the nearest hostile) with the best weapon available.",

  canRun(ctx, target) {
    return resolveMobTarget(ctx.bot, target, MAX_DISTANCE) !== null;
  },

  async run(ctx, target, signal) {
    const { bot } = ctx;
    const mob = resolveMobTarget(bot, target, MAX_DISTANCE);
    if (!mob) return { status: "failed", reason: "no target" };

    const weapon = bestWeapon(bot);
    if (weapon) await watched(bot, "equip", {}, () => doEquip(bot, weapon), signal);
    ctx.log(`attack: fighting ${mob.name ?? "entity"} ${mob.id} with ${weapon?.name ?? "bare hands"}`);

    // Chasing runs beside this loop: the controller keeps the bot within reach while it swings.
    let chasing = false;
    const chase = new AbortController();
    try {
      while (true) {
        if (!isStillThere(bot, mob)) return { status: "done" };
        if (bot.health < LOW_HEALTH && !(ctx.threats?.latest()?.choice.cornered ?? false)) return { status: "failed", reason: "low_health" };
        const distance = distanceTo(bot, mob);
        if (distance > MAX_DISTANCE) return { status: "failed", reason: "target out of range" };

        if (distance > REACH) {
          if (!chasing) void ctx.locomotion.follow(mob, { range: REACH - 1 }, chase.signal).finally(() => (chasing = false));
          chasing = true;
        } else {
          if (chasing) ctx.locomotion.stop();
          await watched(bot, "hit", { entity: mob }, () => doHit(bot, mob), signal);
        }
        await sleepFor(SWING_MS, signal);
      }
    } catch (error) {
      if (signal.aborted) return { status: "interrupted" };
      throw error;
    } finally {
      chase.abort(new Error("attack ended"));
      ctx.locomotion.stop();
    }
  },
};

function distanceTo(bot: Bot, mob: Entity): number {
  return mob.position.distanceTo(bot.entity.position);
}
