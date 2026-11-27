import type { Skill } from "@familiar/contracts";
import { carriedItem } from "../primitives/aim.js";
import { doEquip } from "../primitives/equip.js";
import { doUseItem } from "../primitives/use-item.js";
import { watched } from "../primitives/watch.js";
import type { MinecraftCtx } from "../skill-context.js";

/**
 * Eats or drinks one carried item by name (a bucket of milk, a potion, one particular food):
 * holds it and uses it until it is used up, then lets go.
 */
export const consume: Skill<MinecraftCtx> = {
  name: "consume",
  description: "Eat or drink one carried item: item:<name> (e.g. item:milk_bucket).",
  parts: ["hands"],

  canRun(ctx, target) {
    return target !== undefined && carriedItem(ctx.bot, target) !== null;
  },

  async run(ctx, target, signal) {
    const item = carriedItem(ctx.bot, target);
    if (!item) return { status: "failed", reason: `not carrying "${target}"` };
    ctx.log(`consume: ${item.name}`);
    await doEquip(ctx.bot, item);
    // Noted as it begins as well as when it ends (see eat.ts): an illness arrives with the last mouthful.
    ctx.gut.ate(item.name, Date.now());
    const used = await watched(ctx.bot, "use_item", {}, () => doUseItem(ctx.bot, signal), signal).catch(() => false);
    if (signal.aborted) return { status: "interrupted" };
    if (!used) return { status: "failed", reason: `could not finish the ${item.name}` };
    ctx.gut.ate(item.name, Date.now());
    return { status: "done", changes: { consumed: item.name } };
  },
};
