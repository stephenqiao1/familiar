import type { Skill } from "@familiar/contracts";
import { Vec3 } from "vec3";
import { sleepFor } from "../abort.js";
import { markSteering } from "../posture/falls.js";
import { postureOf } from "../posture/runtime.js";
import type { MinecraftCtx } from "../skill-context.js";
import { parseTarget } from "../target.js";

const GIVE_UP_MS = 5000;
/** The fall is noted a moment after landing, once any hurt has arrived. */
const NOTED_AFTER_MS = 400;
const POLL_MS = 25;
/** The game's own numbers: gravity and drag each tick while falling, and how much sideways speed is kept each tick in the air. */
const AIR = { gravity: 0.08, drag: 0.98, keep: 0.91 };
/** Close enough to the middle of the landing. */
const ON_TARGET = 0.15;

const landed = (ctx: MinecraftCtx) => {
  const e = ctx.bot.entity as { onGround: boolean; isInWater?: boolean };
  return e.onGround || e.isInWater === true;
};

/**
 * How far short of the spot (across the ground) the body would come down if it stopped pushing
 * now: the air keeps carrying it for as many ticks as the fall has left. Negative: it would overshoot.
 */
export function shortBy(position: Vec3, velocity: Vec3, spot: Vec3): number {
  let [height, vy, ticks] = [position.y - spot.y, velocity.y, 0];
  while (height > 0 && ticks < 60) {
    vy = (vy - AIR.gravity) * AIR.drag;
    height += vy;
    ticks++;
  }
  const to = new Vec3(spot.x - position.x, 0, spot.z - position.z);
  const gap = Math.hypot(to.x, to.z);
  // Only speed toward the spot counts.
  const toward = gap > 0 ? (velocity.x * to.x + velocity.z * to.z) / gap : 0;
  const carried = (toward * AIR.keep * (1 - AIR.keep ** ticks)) / (1 - AIR.keep);
  return gap - carried;
}

/**
 * The righting reflex: while falling, heads for a better place to land (given as pos:x,y,z) by
 * facing it and holding forward, letting go early enough to come down on it. Reports the fall in `changes`. Reflex-only.
 */
export const airSteer: Skill<MinecraftCtx> = {
  name: "air_steer",
  description: "While falling, steer toward a better place to land.",
  reflexOnly: true,

  canRun(ctx, target) {
    return target !== undefined && parseTarget(target)?.kind === "pos" && !landed(ctx);
  },

  async run(ctx, target, signal) {
    const parsed = target === undefined ? null : parseTarget(target);
    if (parsed?.kind !== "pos") return { status: "failed", reason: "nowhere to steer for" };
    const spot = new Vec3(parsed.x + 0.5, parsed.y, parsed.z + 0.5);
    markSteering(ctx.bot);
    ctx.log(`air_steer: falling, steering for ${target}`);
    // Push toward it only while the body would otherwise come down short: the air carries it on
    // after the legs stop, and a landing can be one block wide.
    const { bot } = ctx;
    const short = () => shortBy(bot.entity.position, bot.entity.velocity, spot);
    const until = AbortSignal.any([signal, AbortSignal.timeout(GIVE_UP_MS)]);
    while (!landed(ctx) && !until.aborted) {
      if (short() > ON_TARGET) await ctx.locomotion.goTo(spot, { urgent: true, range: 0.1, until: () => landed(ctx) || short() <= ON_TARGET }, until);
      else await sleepFor(POLL_MS, until).catch(() => {});
    }
    if (signal.aborted) return { status: "interrupted" };
    await sleepFor(NOTED_AFTER_MS, signal).catch(() => {});
    const fall = postureOf(ctx.bot).lastFall();
    return { status: "done", changes: { steered: true, ...(fall ? { fell: fall.blocks, damage: fall.damage, landedOn: fall.onto } : {}) } };
  },
};
