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
  /**
   * How vital the need is next to the others (higher = more vital; default 0). While a more
   * vital need presses at all, a lesser one is silent: staying alive comes before stocking up.
   */
  rank?: number;
  /**
   * How much the need darkens the outlook when it is unmet (default 1). A need about the body
   * right now counts in full; one about being provided for (tools, a stock of food) counts for
   * less, since lacking it does not make the next minutes bad; a threat to life counts for more.
   */
  weight?: number;
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

/** One need as it stands in a state: how pressing it is (0 to 1), and how vital it is next to the others. */
export interface Need {
  name: string;
  level: number;
  rank: number;
  weight: number;
}

/** Every need in a state: each rule that reads a level. A rule that throws, or does not apply, is left out. */
export function needsOf(rules: RewardRule[], state: State): Need[] {
  return rules.flatMap((rule) => {
    try {
      const level = rule.level?.(state);
      return typeof level === "number" && Number.isFinite(level) ? [{ name: rule.name, level: Math.min(1, Math.max(0, level)), rank: rule.rank ?? 0, weight: rule.weight ?? 1 }] : [];
    } catch {
      return []; // the same failure is named in the trace when the rule is checked
    }
  });
}

/** How pressing each need is in a state, by rule name. */
export function needLevels(rules: RewardRule[], state: State): Record<string, number> {
  return Object.fromEntries(needsOf(rules, state).map((n) => [n.name, n.level]));
}

/**
 * How strongly each need presses for action right now: its level, unless a more vital need (a
 * higher `rank`) presses at all, which silences it. Staying alive always comes first: with a
 * threat about, nothing lesser is worth setting off for, however far the threat is inside the
 * range that counts. The levels themselves (for learning what relieves a need) are not changed:
 * use `needLevels` for those.
 */
export function pressingNow(rules: RewardRule[], state: State): Record<string, number> {
  const needs = needsOf(rules, state);
  return Object.fromEntries(needs.map((n) => [n.name, needs.some((other) => other.rank > n.rank && other.level > 0) ? 0 : n.level]));
}
