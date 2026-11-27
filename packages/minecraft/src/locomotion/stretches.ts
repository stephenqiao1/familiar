import type { Bot } from "mineflayer";
import type { Vec3 } from "vec3";
import { supportOf } from "../encode/balance.js";
import type { MovementFacts } from "../movements.js";
import { bodyNow } from "../primitives/watch.js";

// A journey crosses more than one kind of ground. While the legs are meant to be moving, the
// ground covered and the time it took are added up by what was underfoot, so the pace on each
// kind of ground can be learned from the journey (by the cerebellum). Measuring only: nothing
// here changes how the bot walks.

/** One stretch of a journey over one kind of ground. */
export interface Stretch {
  facts: MovementFacts;
  blocks: number;
  seconds: number;
}

/** A sample further than this from the one before it is not one stretch of walking (a pause, a recovery, a door). */
const GAP_MS = 1000;
/** Rising or dropping at least this far, and this steeply (rise over ground covered), between two samples is a climb or a drop. */
const SLOPE = { blocks: 0.3, steep: 0.5 };
/** A stretch shorter than this says too little about the pace. */
const WORTH = { blocks: 3, seconds: 1 };

export interface Stretches {
  /** Call each time the journey looks at the body. `moving`: the legs are meant to be covering ground right now. */
  sample(moving: boolean, pattern: string, gait: string, now: number): void;
  /** The stretches long enough to learn from, longest first. */
  all(): Stretch[];
  /** Every stretch, however short: all the ground that was measured. */
  covered(): Stretch[];
}

/** What the body senses of the ground it is on right now, for travel in this pattern at this gait. */
export function groundFacts(bot: Bot, pattern: string, gait: string): MovementFacts {
  const support = supportOf(bot);
  return { pattern, gait, ground: support.on, surface: support.kind, ...bodyNow(bot) };
}

export function createStretches(bot: Bot): Stretches {
  const buckets = new Map<string, Stretch>();
  let last: { pos: Vec3; at: number } | null = null;
  let ground: { on: string; kind: string } | null = null;

  return {
    sample(moving, pattern, gait, now) {
      const pos = bot.entity.position.clone();
      const before = last;
      last = moving ? { pos, at: now } : null;
      if (!moving || !before || now - before.at > GAP_MS || now <= before.at) return;
      const support = supportOf(bot);
      // In the air (a jump, a step down) the ground is still the one the body left.
      if (support.kind !== "none") ground = { on: support.on, kind: support.kind };
      if (!ground) return;
      const body = bodyNow(bot);
      const rise = pos.y - before.pos.y;
      const across = Math.hypot(pos.x - before.pos.x, pos.z - before.pos.z);
      // In water the body bobs: that is no slope.
      const sloped = !body.inWater && Math.abs(rise) >= SLOPE.blocks && Math.abs(rise) >= SLOPE.steep * across;
      const facts: MovementFacts = { pattern, gait, ground: ground.on, surface: ground.kind, ...(sloped ? { slope: rise > 0 ? ("up" as const) : ("down" as const) } : {}), ...body };
      const key = JSON.stringify(facts);
      const stretch = buckets.get(key) ?? { facts, blocks: 0, seconds: 0 };
      stretch.blocks += pos.distanceTo(before.pos);
      stretch.seconds += (now - before.at) / 1000;
      buckets.set(key, stretch);
    },
    covered: () => [...buckets.values()],
    all: () => [...buckets.values()].filter((s) => s.blocks >= WORTH.blocks && s.seconds >= WORTH.seconds).sort((a, b) => b.blocks - a.blocks),
  };
}
