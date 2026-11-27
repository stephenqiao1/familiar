import type { Skill } from "@familiar/contracts";
import type { Bot } from "mineflayer";
import type { Vec3 } from "vec3";
import { headInBlock } from "../encode/touching.js";
import type { Block } from "../mc-types.js";
import { doBreak } from "../primitives/break-block.js";
import { isProtectedBlock } from "../protected.js";
import { postureCheck } from "../posture/check.js";
import { isSafeToStand, nearestSpot, touchesHurt } from "../safety.js";
import { watched } from "../primitives/watch.js";
import type { MinecraftCtx } from "../skill-context.js";

/** Open space is looked for this close; stepping there takes about this long per block. */
const NEAR = 2;
const STEP_MS_PER_BLOCK = 400;
const GIVE_UP_MS = 6000;

/** The block the head is in, if it can be dug safely. */
function headBlock(bot: Bot): Block | null {
  const block = bot.blockAt(bot.entity.position.offset(0, 1.62, 0));
  if (!block || block.boundingBox !== "block" || isProtectedBlock(block.name)) return null;
  return bot.canDigBlock(block) && postureCheck(bot, "dig_out", { kind: "break", at: block.position }) === null ? block : null;
}

/** The nearest open, safe place to stand close by, or null. */
function openSpace(bot: Bot): Vec3 | null {
  return nearestSpot(bot, NEAR, (pos) => isSafeToStand(bot, pos) && !touchesHurt(bot, pos));
}

/**
 * Gets the head out of a solid block (buried by sand or gravel): breaks the block at head
 * height, or moves to the nearest open space, whichever is quicker. Reflex-only.
 */
export const digOut: Skill<MinecraftCtx> = {
  name: "dig_out",
  description: "Get out from inside a block: break it, or move to open space, whichever is quicker.",
  reflexOnly: true,

  canRun(ctx) {
    return headInBlock(ctx.bot);
  },

  async run(ctx, _target, signal) {
    const { bot, locomotion } = ctx;
    locomotion.stop();
    const started = Date.now();
    let how = "";
    while (headInBlock(bot)) {
      if (signal.aborted) return { status: "interrupted" };
      if (Date.now() - started > GIVE_UP_MS) return { status: "failed", reason: "still buried after 6 s", changes: { how } };
      const block = headBlock(bot);
      const space = openSpace(bot);
      const digMs = block ? bot.digTime(block) : Infinity;
      const walkMs = space ? space.distanceTo(bot.entity.position) * STEP_MS_PER_BLOCK : Infinity;
      if (block === null && space === null) return { status: "failed", reason: "buried, with nothing safe to break and nowhere to go", changes: { how } };
      if (walkMs <= digMs) {
        how = "moved to open space";
        ctx.log(`dig_out: moving to open space at ${space}`);
        await locomotion.goTo(space!.offset(0.5, 0, 0.5), { urgent: true, range: 0.4 }, AbortSignal.any([signal, AbortSignal.timeout(1500)]));
      } else {
        how = `broke the ${block!.name}`;
        ctx.log(`dig_out: breaking the ${block!.name} at head height`);
        await watched(bot, "break_block", { block: block!.position }, () => doBreak(bot, block!, signal), signal);
      }
    }
    return { status: "done", changes: { how } };
  },
};
