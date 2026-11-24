import type { Skill } from "@familiar/contracts";
import { sleepFor } from "../abort.js";
import { findCover } from "../cover.js";
import type { MinecraftCtx } from "../skill-context.js";
import { flee } from "./flee.js";

/** It goes right under the roof: within this far of the middle of the covered block. */
const COVER_RANGE = 0.5;
/** Under cover already, it stays put this long before the defence is asked again. */
const STAY_MS = 1000;

/**
 * Running for cover: from something coming down from above, the body goes to the nearest spot
 * with a roof instead of running in the open, and stays under it. With no cover close by it
 * runs away as `flee` does. Reflex-only.
 */
export const takeCover: Skill<MinecraftCtx> = {
  name: "take_cover",
  description: "Run to the nearest spot with a roof overhead (or away, if there is none).",
  reflexOnly: true,
  parts: ["legs", "hands"],

  canRun: (ctx, target) => findCover(ctx.bot) !== null || flee.canRun(ctx, target),

  async run(ctx, target, signal) {
    const { bot, locomotion } = ctx;
    const cover = findCover(bot);
    if (!cover) {
      ctx.log("take_cover: no roof close by, running away instead");
      return flee.run(ctx, target, signal);
    }
    const blocks = Math.round(cover.distanceTo(bot.entity.position));
    try {
      if (blocks < 1) {
        ctx.log("take_cover: under a roof already, staying put");
        await sleepFor(STAY_MS, signal);
        return { status: "done", changes: { cover: `pos:${cover.x},${cover.y},${cover.z}`, blocks: 0 } };
      }
      ctx.log(`take_cover: running ${blocks} blocks to a roof at ${cover.x},${cover.y},${cover.z}`);
      const went = await locomotion.goTo(cover.offset(0.5, 0, 0.5), { range: COVER_RANGE }, signal);
      return went.status === "done" ? { status: "done", changes: { cover: `pos:${cover.x},${cover.y},${cover.z}`, blocks } } : went;
    } catch (error) {
      if (signal.aborted) return { status: "interrupted" };
      throw error;
    }
  },
};
