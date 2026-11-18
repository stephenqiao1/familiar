import { holdMsOf } from "@familiar/region-brainstem";
import { sleepFor } from "../abort.js";
import { pointOf } from "./aim.js";
import { doLookAt } from "./look-at.js";
import { primitive } from "./primitive.js";


/** Stops moving and faces a point for a moment: the body's answer to a full startle. The bigger the startle, the longer the hold (250 to 500 ms). */
export const brace = primitive({
  name: "brace",
  description: "Stop moving and face a target (or just stop) for a moment.",
  parts: ["legs", "head"],
  expects: [],
  settleMs: 0,

  canRun() {
    return true;
  },

  async run(ctx, target, signal) {
    const { bot } = ctx;
    // Ends any journey and lets go of every key.
    ctx.locomotion.stop();
    const point = pointOf(bot, target);
    if (point) await doLookAt(bot, point);
    await sleepFor(holdMsOf(ctx.level?.("startle") ?? 0), signal);
    return { status: "done" };
  },
});
