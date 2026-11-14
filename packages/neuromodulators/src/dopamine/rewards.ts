import type { SkillEvent, State } from "@familiar/contracts";
import type { Habituation } from "./habituation.js";

/** What a reward rule compares: the state at the last tick, this tick's state, and the skill events in between. */
export interface RewardMoment {
  before: State;
  after: State;
  events: readonly SkillEvent[];
}

/** Positive when a need got smaller, negative when something bad happened. */
export interface Reward {
  amount: number;
  /** Plain words for the log, e.g. "food 2 → 10". */
  reason: string;
  /** The bot died: the skill that led to it is punished hard (see the dopamine region). */
  fatal?: boolean;
}

/** One kind of reward: look at what changed since the last tick, and score it or return nothing. */
export interface RewardRule {
  name: string;
  /** The need it belongs to (hunger, safety, ...). */
  need: string;
  /** False for a rule that handles its own repeats (e.g. novelty). Default: true. */
  habituates?: boolean;
  check(moment: RewardMoment): Reward | null;
}

/** A reward as logged: its rule and need, and the amount before habituation shrank it. */
export type LoggedReward = Reward & { rule: string; need: string; raw?: number; repeats?: number };

/**
 * Runs every rule and shrinks repeated rewards from the same rule (unless it opts out).
 * A rule that throws is skipped and its error kept.
 */
export function checkRules(rules: RewardRule[], moment: RewardMoment, habituation: Habituation) {
  const rewards: LoggedReward[] = [];
  const errors: Record<string, string> = {};
  for (const rule of rules) {
    try {
      const reward = rule.check(moment);
      if (!reward) continue;
      const logged: LoggedReward = { rule: rule.name, need: rule.need, ...reward };
      if (rule.habituates !== false) {
        const { amount, repeats } = habituation.dampen(rule.name, reward.amount, moment.after.timestamp);
        if (repeats > 0) Object.assign(logged, { amount, raw: reward.amount, repeats: Math.round(repeats * 10) / 10 });
      }
      rewards.push(logged);
    } catch (error) {
      errors[rule.name] = error instanceof Error ? error.message : String(error);
    }
  }
  return { rewards, errors };
}
