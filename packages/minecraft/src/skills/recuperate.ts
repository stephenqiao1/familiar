import type { Skill } from "@familiar/contracts";
import { sleepFor } from "../abort.js";
import type { MinecraftCtx } from "../skill-context.js";

/** Home is gone to if it is within this many blocks; further off, the bot rests where it is. */
const HOME_WITHIN = 48;
const HOME_RANGE = 2;
/** Mended at this health (of 20). */
const MENDED = 15;
const REST_MS = 1000;

/**
 * Recuperating: after a fight or a flight, with nothing coming, the body goes home if home is
 * near, then stays still until its health is back (eating is left to the medulla's own urge,
 * which takes over for the moment it needs). Reflex-only.
 */
export const recuperate: Skill<MinecraftCtx> = {
  name: "recuperate",
  description: "Go home if it is near, then rest until health is back.",
  reflexOnly: true,
  parts: ["legs"],

  canRun: (ctx) => ctx.bot.health < MENDED,

  async run(ctx, _target, signal) {
    const { bot, base, locomotion } = ctx;
    const started = Date.now();
    const from = bot.health;
    try {
      const home = base?.chest;
      const far = home ? bot.entity.position.distanceTo(home) : Infinity;
      let wentHome = false;
      if (home && far > HOME_RANGE + 1 && far <= HOME_WITHIN) {
        ctx.log(`recuperate: heading home to rest (${Math.round(far)} blocks)`);
        wentHome = (await locomotion.goTo(home, { range: HOME_RANGE }, signal)).status === "done";
      } else ctx.log("recuperate: resting here");
      while (bot.health < MENDED) await sleepFor(REST_MS, signal);
      return { status: "done", changes: { restedMs: Date.now() - started, healthFrom: from, healthTo: bot.health, wentHome } };
    } catch (error) {
      if (signal.aborted) return { status: "interrupted", changes: { restedMs: Date.now() - started, healthFrom: from, healthTo: bot.health } };
      throw error;
    }
  },
};
