import type { Verdict } from "@familiar/contracts";

// Is more effort worth it? control = trouble × stake × chance − cost, kept between 0 and 1.
// Plain numbers in, plain numbers out: nothing here reads the workspace.

const clamp = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** How far a learning rate follows `changeable`: a rate is multiplied by (0.5 + changeable), so half in a steady world and half as much again in a changing one. `strength` 0: left as it is. */
export const rateScale = (changeable: number, strength: number) => 1 + clamp(strength) * (0.5 + clamp(changeable) - 1);

/** Control at or above this: try harder. */
export const TRY_HARDER_AT = 0.5;
/** Trouble at or above this that is not worth more effort, for this long, is to be left. */
export const LEAVE_IT = { trouble: 0.4, controlUnder: 0.1, afterMs: 15_000 };
/** The stay-or-leave reading at or above this is a verdict to leave by itself. */
export const LEAVE_AT = 0.8;
/** With nothing making more thought likely to help, the chance is this. */
export const BASE_CHANCE = 0.3;
/** With a reflex already dealing with it, the chance is cut to this share. */
export const REFLEX_HAS_IT = 0.2;
/** How much each part of the cost can add: thinking already spent, tiredness, stress above half. */
export const COST = { spent: 0.6, tired: 0.2, stress: 0.2 };
/** The most a low mood takes off the stake. */
export const LOW_MOOD_TAKES = 0.2;

export interface Stake {
  /** How hard the strongest need presses, 0 to 1. */
  need: number;
  /** The goal's priority, 0 with no goal. */
  goal: number;
  /** What the running skill is worth here, 0 to 1. */
  skill: number;
}

export interface Chance {
  /** How close the options are, 0 to 1 (a near tie is 1). */
  close: number;
  /** How little the leading option is known, 0 (well worn) to 1 (never tried). */
  unknown: number;
  /** How unfamiliar the thing or place involved is, 0 to 1. */
  unfamiliar: number;
  /** A reflex is already dealing with it. */
  reflex: boolean;
}

export interface Spent {
  /** Thinking spent in the last minute, in calls. */
  calls: number;
  /** The most that may be spent in a minute. */
  budget: number;
  tired: number;
  stress: number;
}

/** How much is riding on it: the most of the three, lowered a little by a low mood (`moodStrength` 0: not at all). */
export function stakeOf(stake: Stake, mood = 0, moodStrength = 0): number {
  return clamp(Math.max(stake.need, stake.goal, stake.skill) * (1 - LOW_MOOD_TAKES * clamp(moodStrength) * clamp(-mood)));
}

/** How likely more thought is to help. */
export function chanceOf(chance: Chance): number {
  return clamp((BASE_CHANCE + (1 - BASE_CHANCE) * clamp(Math.max(chance.close, chance.unknown, chance.unfamiliar))) * (chance.reflex ? REFLEX_HAS_IT : 1));
}

/** What more thinking costs: little until the budget is nearly spent, then steeply; more when tired or under high stress. */
export function costOf(spent: Spent): number {
  return clamp(COST.spent * clamp(spent.calls / spent.budget) ** 3 + COST.tired * clamp(spent.tired) + COST.stress * clamp((spent.stress - 0.5) * 2));
}

/** Whether the budget for thinking is used up. */
export const budgetSpent = (spent: Pick<Spent, "calls" | "budget">) => spent.calls >= spent.budget;

export function controlOf(trouble: number, stake: number, chance: number, cost: number): number {
  return clamp(clamp(trouble) * clamp(stake) * clamp(chance) - clamp(cost));
}

/**
 * The verdict, and why when it is not plain. With the budget spent it is always "carry on":
 * control can ask for more thought, never for more than the budget allows.
 */
export function verdictOf(now: { control: number; trouble: number; leave: number; spent: boolean; troubledMs: number }): { verdict: Verdict; why?: string } {
  if (now.spent) return { verdict: "carry on", why: "the call budget is spent" };
  if (now.control >= TRY_HARDER_AT) return { verdict: "try harder" };
  if (now.leave >= LEAVE_AT) return { verdict: "leave it", why: "it is paying much worse than things have in general" };
  if (now.trouble >= LEAVE_IT.trouble && now.control < LEAVE_IT.controlUnder && now.troubledMs >= LEAVE_IT.afterMs) return { verdict: "leave it", why: "trouble that more effort is not worth" };
  return { verdict: "carry on" };
}
