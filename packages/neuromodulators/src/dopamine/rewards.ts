import type { SkillEvent, State } from "@familiar/contracts";

/** What a reward rule compares: the state at the last tick, this tick's state, and the skill events in between. */
export interface RewardMoment {
  before: State;
  after: State;
  events: readonly SkillEvent[];
}

/** Positive when a need got smaller; negative when one grew, or something bad happened. */
export interface Reward {
  amount: number;
  /** Plain words for the log, e.g. "food 2 → 10". */
  reason: string;
  /** The bot died: the skill that led to it is punished hard (see the dopamine region). */
  fatal?: boolean;
  /**
   * The skill this reward is about (e.g. the one that failed). It goes to that skill's run and
   * to no other. Without it the reward is nobody's in particular, and goes to whichever skill ran
   * for the most of the tick.
   */
  skill?: string;
}

/** One kind of reward: look at what changed since the last tick, and score it or return nothing. */
export interface RewardRule {
  name: string;
  /** The need it belongs to (hunger, safety, ...). */
  need: string;
  /** One reward, several (e.g. one for each skill that failed), or nothing. */
  check(moment: RewardMoment): Reward | Reward[] | null;
  /**
   * For a rule that pays the change in a need: how pressing that need is in this state (0 =
   * satisfied, 1 = desperate), or null where it does not apply. With it, the bot learns which
   * things relieve the need and wants them as much as the need presses (see wantNow).
   */
  level?(state: State): number | null;
}

/** A reward as logged: with its rule and need. */
export type LoggedReward = Reward & { rule: string; need: string };

/** Runs every rule. A rule that throws is skipped and its error kept. */
export function checkRules(rules: RewardRule[], moment: RewardMoment) {
  const rewards: LoggedReward[] = [];
  const errors: Record<string, string> = {};
  for (const rule of rules) {
    try {
      const found = rule.check(moment);
      for (const reward of found === null ? [] : Array.isArray(found) ? found : [found]) rewards.push({ rule: rule.name, need: rule.need, ...reward });
    } catch (error) {
      errors[rule.name] = error instanceof Error ? error.message : String(error);
    }
  }
  return { rewards, errors };
}

/**
 * The levels of the rules that read one of their own, by rule name (0 = satisfied, 1 = desperate).
 * A rule that throws, or does not apply, is left out. The body's needs are not rules: the
 * hypothalamus reads those (see the region's `needs` option).
 */
export function needLevels(rules: RewardRule[], state: State): Record<string, number> {
  const levels: Record<string, number> = {};
  for (const rule of rules) {
    try {
      const level = rule.level?.(state);
      if (typeof level === "number" && Number.isFinite(level)) levels[rule.name] = Math.min(1, Math.max(0, level));
    } catch {
      // The same failure is named in the trace when the rule is checked.
    }
  }
  return levels;
}
