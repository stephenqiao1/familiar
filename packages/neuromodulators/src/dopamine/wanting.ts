import { needChangeReward } from "./need-change.js";

/** How pressing each need is right now (0 = satisfied, 1 = desperate), by the name of its rule. */
export type NeedLevels = Record<string, number>;

/**
 * The scorebook's name for what running a skill does to one need: how far it usually brings that
 * need's level down (its relief). Filed like any skill, so it is learned by the same levels
 * (the skill in general, each label of the situation, the kind of thing, that thing).
 */
export const reliefOf = (skill: string, need: string) => `${skill} ⇒ ${need}`;

/** The scorebook's name for the work a skill usually takes (in reward units), filed the same way. */
export const effortOf = (skill: string) => `${skill} ⇒ (effort)`;

/** A run that did not finish (cut short, or failed) this many times in a row is trusted half as much to have been going to pay. */
export const CUT_SHORT_HALF_LIFE = 4;

/** How far a run cut short is still trusted to have been going to deliver, after `cutShort` cut-offs in a row with no finished run between. */
export function trustAfter(cutShort: number): number {
  return 0.5 ** (cutShort / CUT_SHORT_HALF_LIFE);
}

/** After a run that did not finish, the same want waits this long before it is acted on again; twice as long for each more in a row, up to the most. */
export const RETRY = { afterMs: 1000, atMostMs: 60_000 };

/** How long a want waits before it is tried again, after `unfinished` runs toward it in a row had already not finished. */
export function retryAfter(unfinished: number): number {
  return Math.min(RETRY.atMostMs, RETRY.afterMs * 2 ** Math.max(0, unfinished));
}

/**
 * What a run cut short is taken to have been going to deliver in all: what it got, plus the
 * trusted share of what was expected and had not come yet. Never less than what it got.
 */
export function withTheRest(got: number, expected: number, trust: number): number {
  return got + trust * Math.max(0, expected - got);
}

/**
 * Whether a run's relief of a need says anything about what to expect. A need can only fall as
 * far as it stood: a full bot that takes bread from a chest shows no relief, and that says
 * nothing about the chest. So a relief below what was expected is believed only if the need
 * stood high enough at the start to have shown the expected relief.
 */
export function reliefIsTelling(levelAtStart: number, relief: number, expected: number): boolean {
  return relief >= expected || levelAtStart >= expected;
}

/**
 * What a relief would pay right now: the reward for each need moving from its level now to where
 * the expected relief would leave it. So the same chest of bread is wanted a lot with no food
 * left and not at all with enough, and something expected to make a need worse counts against.
 * Returns the total and each need's part of it (parts of nothing are left out).
 */
export function wantNow(levels: NeedLevels, expectedRelief: (need: string) => number): { want: number; parts: Record<string, number> } {
  const parts: Record<string, number> = {};
  let want = 0;
  for (const [need, level] of Object.entries(levels)) {
    const pays = needChangeReward(level, Math.min(1, Math.max(0, level - expectedRelief(need))));
    if (pays === 0) continue;
    parts[need] = pays;
    want += pays;
  }
  return { want, parts };
}

/** With the worst need left wholly unmet, an option keeps this much of its hold on the body. */
export const LEAST_HOLD = 0.5;

/**
 * How much of its hold on the body an option keeps (0 to 1; 1 = all of it), given the worst
 * need it is not expected to relieve. It follows the same curve as the need's reward (the
 * square of how pressing the need would still be): a mild need changes almost nothing, and
 * with a need desperate, an option that does not serve it loses up to half its hold.
 * `strength` scales the effect (0: none).
 */
export function holdNow(levels: NeedLevels, expectedRelief: (need: string) => number, strength = 1): number {
  const unmet = Math.max(0, ...Object.entries(levels).map(([need, level]) => Math.min(1, level - expectedRelief(need))));
  return 1 - (1 - LEAST_HOLD) * Math.min(1, Math.max(0, strength)) * unmet ** 2;
}
