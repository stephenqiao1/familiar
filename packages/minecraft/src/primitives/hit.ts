import type { Bot } from "mineflayer";
import type { Entity } from "../mc-types.js";
import { nearestHostile } from "../mobs.js";
import { entityOf, REACH, withinReach } from "./aim.js";
import { doLookAt } from "./look-at.js";
import { primitive } from "./primitive.js";

/** Faces an entity and swings at it once, with whatever is in hand. */
export async function doHit(bot: Bot, entity: Entity): Promise<void> {
  await doLookAt(bot, entity.position.offset(0, entity.height * 0.8, 0));
  bot.attack(entity);
}

/** Swings once at something within reach, with whatever is in hand. */
export const hit = primitive({
  name: "hit",
  description: "Swing once at an entity within reach (entity:<id> or ahead; default: the nearest hostile).",
  parts: ["hands", "head"],
  expects: ["targetHurt"],
  risky: true,
  settleMs: 300,
  defaultTarget(ctx) {
    const hostile = nearestHostile(ctx.bot, REACH);
    return hostile ? `entity:${hostile.id}` : undefined;
  },

  canRun(ctx, target) {
    return inReach(ctx.bot, target) !== null;
  },

  async run(ctx, target, signal) {
    const entity = inReach(ctx.bot, target);
    if (!entity) return { status: "failed", reason: "nothing within reach" };
    if (signal.aborted) return { status: "interrupted" };
    await doHit(ctx.bot, entity);
    return { status: "done" };
  },
});

function inReach(bot: Bot, target: string | undefined): Entity | null {
  const entity = target === undefined ? nearestHostile(bot, REACH) : entityOf(bot, target);
  return entity && entity.id !== bot.entity.id && withinReach(bot, entity.position.offset(0, entity.height * 0.5, 0)) ? entity : null;
}
