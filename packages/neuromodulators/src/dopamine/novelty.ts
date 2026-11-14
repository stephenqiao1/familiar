import type { State } from "@familiar/contracts";
import type { RewardRule } from "./rewards.js";

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
  noticed(state: State): string[];
  memory: NoveltyMemory;
  /** Reward for meeting a kind for the first time. Default: 0.5. */
  bonus?: number;
}

/**
 * Novelty that wears off: each time a kind of thing comes into view (it wasn't noticed last tick),
 * reward bonus × ½^(times met before). Staying in view counts once. Everything noticed on the
 * first tick counts as coming into view. Several arrivals at once pay at most one full bonus, so
 * joining a world full of new things does not flood the bot with reward.
 */
export function createNoveltyRule({ noticed, memory, bonus = 0.5 }: NoveltyOptions): RewardRule {
  let inView = new Set<string>();
  return {
    name: "novelty",
    need: "curiosity",
    habituates: false, // it already halves per kind
    check({ after }) {
      const now = new Set(noticed(after));
      const arrived = [...now].filter((kind) => !inView.has(kind));
      inView = now;
      if (!arrived.length) return null;
      const met = arrived.map((kind) => ({ kind, before: memory.meet(kind) }));
      const amount = Math.min(bonus, met.reduce((sum, m) => sum + bonus * 0.5 ** m.before, 0));
      return { amount, reason: met.map((m) => (m.before ? `${m.kind} (seen ${m.before}×)` : `new ${m.kind}`)).join(", ") };
    },
  };
}
