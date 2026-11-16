import type { Skill } from "@familiar/contracts";
import type { Bot } from "mineflayer";
import type { Vec3 } from "vec3";
import { atEdge, isSafeToStand, nearestSpot, touchesHurt } from "../safety.js";
import type { MinecraftCtx } from "../skill-context.js";

const SEARCH_RADIUS = 6;
const GIVE_UP_MS = 4000;

/**
 * The nearest place to pull back to: safe to stand, not touching anything known to hurt, not at
 * the edge of a big drop (the "other leg" rule: the place moved to must itself hold), and at
 * least `radius` blocks from where it hurt. Null if there is none within 6 blocks.
 */
export function refugeFrom(bot: Bot, hurtAt: Vec3, radius: number): Vec3 | null {
  return nearestSpot(bot, SEARCH_RADIUS, (pos) => pos.distanceTo(hurtAt) >= radius && isSafeToStand(bot, pos) && !touchesHurt(bot, pos) && !atEdge(bot, pos));
}

/**
 * Pulls away from whatever just hurt, without needing to know what it is: moves to the nearest
 * safe place at least 2 blocks from where it hurt (4, then 6, if hurt again there). It blames a
 * cause, learns from it, marks the spot to keep away from, and reports all of that in `changes`.
 * If nowhere within 6 blocks is safe it stays put: it never walks into worse. Reflex-only.
 */
export const withdraw: Skill<MinecraftCtx> = {
  name: "withdraw",
  description: "Pull away from whatever just hurt, to the nearest safe place.",
  reflexOnly: true,

  canRun(ctx) {
    return ctx.lastHurt() !== null;
  },

  async run(ctx, _target, signal) {
    const { bot, locomotion, pain } = ctx;
    const hurt = ctx.lastHurt();
    if (!hurt) return { status: "failed", reason: "nothing hurt" };
    const now = Date.now();
    const { causes, learned, refused, radius } = pain.withdrew(hurt, now);
    const at = bot.entity.position.clone().set(hurt.where.x, hurt.where.y, hurt.where.z);
    // Switch off whatever was carrying the bot toward the harm, and keep routes away from it.
    locomotion.stop();
    locomotion.avoid(hurt.where);
    const changes: Record<string, unknown> = { cause: causes.join(", ") || hurt.kind || "unknown", hurtAt: `${hurt.where.x},${hurt.where.y},${hurt.where.z}`, hurtToStartMs: now - hurt.at, radius };
    if (learned.length) {
      changes.learned = learned.join(", ");
      ctx.log(`withdraw: learned that ${learned.join(", ")} hurts`);
    }
    if (refused.length) {
      changes.notLearned = refused.join(", ");
      ctx.log(`withdraw: the evidence points at ${refused.join(", ")}, which is never learned as harmful`);
    }
    const refuge = refugeFrom(bot, at, radius);
    if (!refuge) {
      ctx.log(`withdraw: nowhere safe within ${SEARCH_RADIUS} blocks; staying put`);
      return { status: "failed", reason: `nowhere safe within ${SEARCH_RADIUS} blocks`, changes };
    }
    changes.to = `${refuge.x},${refuge.y},${refuge.z}`;
    ctx.log(`withdraw: hurt by ${changes.cause as string} at ${changes.hurtAt as string}; pulling back ${radius}+ blocks to ${changes.to as string}`);
    const tooLong = AbortSignal.timeout(GIVE_UP_MS);
    const journey = await locomotion.goTo(refuge.offset(0.5, 0, 0.5), { urgent: true, range: 0.4 }, AbortSignal.any([signal, tooLong]));
    const status = journey.status === "interrupted" && !signal.aborted ? "failed" : journey.status;
    return { status, ...(status === "failed" ? { reason: journey.reason ?? "could not reach safety in 4 s" } : {}), changes: { ...journey.changes, ...changes } };
  },
};
