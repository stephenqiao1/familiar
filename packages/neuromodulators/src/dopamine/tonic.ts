/** The workspace signal that carries the tonic dopamine level. */
export const DOPAMINE_SIGNAL = "dopamine";
/** The workspace signal that carries this tick's positive reward (0 when there was none). */
export const REWARD_SIGNAL = "reward";
/** The workspace signal that carries the size (0 to 1, good or bad) of the biggest surprise from a skill that just ended. */
export const SURPRISE_SIGNAL = "surprise";
/** The size (0 to 1) of the worst bad surprise from a skill that just ended: its outcome fell short of what was expected. */
export const BAD_SURPRISE_SIGNAL = "bad_surprise";
/** The workspace signal that carries this tick's novelty reward (0 when nothing new came into view). */
export const NOVELTY_SIGNAL = "novelty";
/** DA with no recent reward, unless a personality says otherwise. */
export const RESTING_DA = 0.5;
/** Guardrail against giving up forever: DA never drops below this, and drifts back to rest. */
export const DA_FLOOR = 0.15;
/** How fast past rewards fade: after this long one counts for about a third (1/e). */
const FADE_MS = 180_000;
/**
 * How strongly recent reward pushes DA away from rest. The fading total is about three minutes'
 * worth of reward, so this makes DA follow the reward rate: a steady +1 a minute holds DA near 0.82,
 * a single +1 lifts it to about 0.62, and it takes a lot to reach the ends. (Live runs at a higher
 * gain pinned DA at its ceiling for minutes in any new place.)
 */
const GAIN = 0.5;

/**
 * Tonic dopamine (DA): a slow level from 0 to 1 that follows how much reward came in over the
 * last few minutes. Each call fades the past total by the time since the last call, adds the new
 * reward, and squashes the total into 0..1 (no recent reward = the resting level, mostly good =
 * near 1, mostly bad = down to DA_FLOOR).
 */
export interface TonicDopamine {
  /** Adds `reward` received at time `at` (ms) and returns the new DA level. */
  update(reward: number, at: number): number;
}

export function createTonicDopamine(restingDA = RESTING_DA): TonicDopamine {
  /** Shifts the curve so a total of 0 lands on the resting level. */
  const offset = Math.log(restingDA / (1 - restingDA));
  let recent = 0;
  let last: number | null = null;
  return {
    update(reward, at) {
      if (last !== null) recent *= Math.exp(-Math.max(0, at - last) / FADE_MS);
      last = at;
      recent += reward;
      return Math.max(DA_FLOOR, 1 / (1 + Math.exp(-(GAIN * recent + offset))));
    },
  };
}
