import type { State, Workspace } from "@familiar/contracts";
import { needChangeReward } from "./need-change.js";
import type { RewardMoment, RewardRule } from "./rewards.js";

/** How many times the bot has met each kind of thing. */
export interface NoveltyMemory {
  /** Counts one more meeting with `kind`; returns how many times it was met before. */
  meet(kind: string): number;
  /** Every count so far, for saving. */
  entries(): Record<string, number>;
}

export function createNoveltyMemory(saved: Record<string, number> = {}): NoveltyMemory {
  const counts = new Map(Object.entries(saved));
  return {
    meet(kind) {
      const before = counts.get(kind) ?? 0;
      counts.set(kind, before + 1);
      return before;
    },
    entries: () => Object.fromEntries(counts),
  };
}

export interface NoveltyOptions {
  /** The kinds of things the bot notices in a state (e.g. "cow", "biome:plains"). */
  noticed(state: State, ws?: Workspace): string[];
  memory: NoveltyMemory;
  /** How much of its boredom one brand-new kind of thing takes away (0 to 1). Default: 0.5. */
  bonus?: number;
  /** How long with nothing new until boredom is complete, in ms. Default: ten minutes. */
  fillMs?: number;
  /** The start of a new life (e.g. a respawn): what is in view is noted, but nothing is paid or charged. Default: never. */
  fresh?(moment: RewardMoment): boolean;
}

/** Boredom when the bot starts: half way. */
const STARTING_BOREDOM = 0.5;
/** Boredom is paid for in steps this big, so a slow climb is a few small charges, not one every tick. */
const STEP = 0.05;

/**
 * Curiosity as a need. Boredom (0 to 1) builds slowly while nothing new comes into view, and a
 * kind of thing coming into view takes some of it away: a share of `bonus` × ½^(times met
 * before), so a thing met often relieves little. The reward is the signed change in boredom,
 * like every other need: getting bored costs, and something new pays back at most the boredom
 * that had built up. So a crowd of new things cannot pay more than one long dull spell cost.
 * Staying in view counts once. Everything noticed on the first tick counts as coming into view.
 */
export function createNoveltyRule({ noticed, memory, bonus = 0.5, fillMs = 600_000, fresh }: NoveltyOptions): RewardRule {
  let inView = new Set<string>();
  let boredom = STARTING_BOREDOM;
  let paid = STARTING_BOREDOM;
  let last: number | null = null;
  return {
    name: "novelty",
    need: "curiosity",
    level: () => paid,
    check(moment) {
      const { after } = moment;
      if (last !== null) boredom = Math.min(1, boredom + Math.max(0, after.timestamp - last) / fillMs);
      last = after.timestamp;
      const now = new Set(noticed(after, moment.ws));
      const arrived = [...now].filter((kind) => !inView.has(kind));
      inView = now;
      const met = arrived.map((kind) => ({ kind, before: memory.meet(kind) }));
      boredom *= 1 - Math.min(1, met.reduce((sum, m) => sum + bonus * 0.5 ** m.before, 0));
      const level = Math.round(boredom / STEP) * STEP;
      if (fresh?.(moment)) {
        paid = level;
        return null;
      }
      if (level === paid) return null;
      const amount = needChangeReward(paid, level);
      paid = level;
      const what = met.map((m) => (m.before ? `${m.kind} (seen ${m.before}×)` : `new ${m.kind}`)).join(", ");
      return { amount, reason: amount > 0 ? what || "something new" : "nothing new for a while" };
    },
  };
}
