import type { Skill } from "@familiar/contracts";
import { sleepFor } from "../abort.js";
import { isStillThere, resolveMobTarget } from "../mobs.js";
import { doLookAt } from "../primitives/look-at.js";
import { doSneak } from "../primitives/sneak.js";
import type { MinecraftCtx } from "../skill-context.js";

const WATCH_MS = 250;
/** With no threat sense to say the freeze is over, it ends after this long. */
const LONGEST_MS = 20_000;
const LOOKUP_RADIUS = 32;

/**
 * Freezing: the passive defence. The body stops where it is, crouches, and keeps its eyes on
 * the threat, so as not to be noticed. It ends when the defence circuit stops choosing to
 * freeze for this threat (it noticed, it left, or something else is now more pressing), or the
 * threat is gone. Reflex-only.
 */
export const freeze: Skill<MinecraftCtx> = {
  name: "freeze",
  description: "Hold still, crouched, watching a threat that has not noticed the bot.",
  reflexOnly: true,
  parts: ["legs", "head"],

  canRun(ctx, target) {
    return target !== undefined && resolveMobTarget(ctx.bot, target, LOOKUP_RADIUS) !== null;
  },

  async run(ctx, target, signal) {
    const { bot, locomotion } = ctx;
    const threat = resolveMobTarget(bot, target, LOOKUP_RADIUS);
    if (!threat) return { status: "failed", reason: "nothing to freeze for" };
    const started = Date.now();
    locomotion.stop();
    doSneak(bot, true);
    ctx.log(`freeze: holding still for ${threat.name ?? "entity"} ${threat.id}`);
    const done = (why: string) => ({ status: "done" as const, changes: { heldMs: Date.now() - started, ended: why } });
    try {
      while (true) {
        if (!isStillThere(bot, threat)) return done("the threat is gone");
        const choice = ctx.threats?.latest()?.choice;
        if (choice ? choice.mode !== "freeze" || choice.target !== target : Date.now() - started >= LONGEST_MS) return done(choice ? `the defence is now ${choice.mode}` : "held long enough");
        await doLookAt(bot, threat.position.offset(0, threat.height * 0.9, 0)).catch(() => {});
        await sleepFor(WATCH_MS, signal);
      }
    } catch (error) {
      if (signal.aborted) return { status: "interrupted", changes: { heldMs: Date.now() - started } };
      throw error;
    } finally {
      doSneak(bot, false);
    }
  },
};
