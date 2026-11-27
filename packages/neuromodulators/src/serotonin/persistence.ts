import type { SkillEvent } from "@familiar/contracts";
import { retryAfter } from "../dopamine/wanting.js";
import { giveUpFactor } from "./effects.js";

/** The most the running skill's score is raised to keep it going (when it has only just got somewhere). */
export const MAX_STAY_BONUS = 0.15;
/**
 * A running skill is protected for this long after it last got somewhere, at neutral patience
 * (half as long at none, half as long again at full). Getting somewhere is a reward, a need
 * easing, ground covered, or whatever else the body reports through `progress`.
 */
export const PROGRESS_WINDOW_MS = 10_000;
/** Guardrail: after this many times the base time on one skill with no success or progress, patience is ignored. */
const OVER_PERSISTING_FACTOR = 3;

/** Giving up on a skill counts as this many unfinished tries already: the first wait before trying it again is 8 s, then 16, 32, up to a minute. */
const GIVING_UP_COUNTS_AS = 3;

/** Where the running skill stands against its give-up time, for the log. */
export interface PersistenceStatus {
  skill: string;
  /** Seconds since the skill started or last made progress. */
  waitedSeconds: number;
  /** How fresh that progress still is, from 1 (just now) to 0 (none inside the window): what the stay bonus goes by. */
  progress: number;
  giveUpSeconds: number;
  /** The give-up time at neutral patience with an even chance, for this skill (the fixed base, or its own learned one). */
  baseSeconds: number;
  patience: number;
  chanceOfPayoff: number;
  stayBonus: number;
  /** The over-persisting guardrail fired: patience is being ignored. */
  overPersisting: boolean;
}

/**
 * Effect a, persistence: the bot's "should I quit?" step, asked every tick about the running
 * skill. Its give-up time is base × (0.5 + patience) × (0.5 + chance of payoff), worked out from
 * the current patience, and its clock restarts whenever the skill makes progress.
 *   - While it is getting somewhere, the skill gets a stay bonus, so a challenger must be clearly
 *     better to take over. The bonus fades over a few seconds with no progress (longer for a
 *     patient bot): protection is for what is working, not for whatever happens to be running.
 *   - When the time is up, the skill is given up on, and may not be started again at once.
 */
export interface Persistence {
  /** Feed every skill event, in order. */
  observe(event: SkillEvent): void;
  /** The running skill got somewhere (a reward, a need easing, ground covered): its clock restarts. */
  progress(now: number): void;
  /** How much to raise this skill's score for being the one already running; 0 for any other. */
  stayBonus(skill: string, now: number): number;
  /** Why to give up on the running skill now, or null to keep going. */
  giveUpReason(now: number): string | null;
  /** The skill was given up on a moment ago and may not be started again yet (see retryAfter). A run that finishes ends the wait. */
  heldBack(skill: string, now: number): boolean;
  /** The longest a skill may run at all, as a backstop for one that hangs. */
  backstopMs(): number;
  /** The running skill's status, or null if none is running. */
  status(now: number): PersistenceStatus | null;
}

export function createPersistence(options: {
  patience(): number;
  /** The chance (0 to 1) this skill pays off here, e.g. its past success rate; 0.5 if unknown. */
  chanceOf(skill: string): number;
  /** 0 = off (no stay bonus, and skills simply stop at the base time), 1 = full. */
  strength: number;
  /** The give-up time at neutral patience with an even chance of payoff. Default: 120 000. */
  baseMs?: number;
  /** A skill's own base, if something has learned how long it usually takes (bounded by whoever supplies it). Default: `baseMs` for every skill. */
  baseOf?(skill: string, now: number): number;
  /** The most `baseOf` may answer, for the backstop. Default: `baseMs`. */
  mostBaseMs?: number;
}): Persistence {
  const { patience, chanceOf, strength, baseMs = 120_000 } = options;
  let running: { skill: string; clockFrom: number } | null = null;
  /** Time spent on one skill, across back-to-back runs, since it last succeeded or made progress. */
  let streak = { skill: "", ms: 0 };
  /** The skill a give-up was just called on, and each skill given up on: how often in a row, and until when it waits. */
  let givingUpOn: string | null = null;
  const waiting = new Map<string, { times: number; until: number }>();

  function status(now: number): PersistenceStatus | null {
    if (!running) return null;
    const waited = now - running.clockFrom;
    const base = options.baseOf?.(running.skill, now) ?? baseMs;
    const overPersisting = streak.ms + waited > OVER_PERSISTING_FACTOR * base;
    const p = overPersisting ? 0.5 : patience();
    const chance = chanceOf(running.skill);
    const giveUpMs = base * giveUpFactor(p, chance, strength);
    const progress = Math.max(0, 1 - waited / (PROGRESS_WINDOW_MS * (0.5 + p)));
    return {
      skill: running.skill,
      waitedSeconds: waited / 1000,
      progress,
      giveUpSeconds: giveUpMs / 1000,
      baseSeconds: base / 1000,
      patience: p,
      chanceOfPayoff: chance,
      stayBonus: strength * MAX_STAY_BONUS * progress,
      overPersisting,
    };
  }

  return {
    observe(event) {
      if (event.type === "started") {
        if (streak.skill !== event.skill) streak = { skill: event.skill, ms: 0 };
        running = { skill: event.skill, clockFrom: event.timestamp };
        return;
      }
      if (running?.skill !== event.skill) return;
      if (event.type === "done") waiting.delete(event.skill);
      else if (givingUpOn === event.skill) {
        const times = waiting.get(event.skill)?.times ?? 0;
        waiting.set(event.skill, { times: times + 1, until: event.timestamp + retryAfter(times + GIVING_UP_COUNTS_AS) });
      }
      givingUpOn = null;
      streak.ms = event.type === "done" ? 0 : streak.ms + (event.timestamp - running.clockFrom);
      running = null;
    },
    progress(now) {
      if (!running) return;
      running.clockFrom = now;
      streak.ms = 0;
    },
    stayBonus(skill, now) {
      const s = status(now);
      return s?.skill === skill ? s.stayBonus : 0;
    },
    giveUpReason(now) {
      const s = status(now);
      if (strength <= 0 || !s || s.waitedSeconds < s.giveUpSeconds) return null;
      givingUpOn = s.skill;
      const why = s.overPersisting ? "kept at it too long with no progress" : `patience ${s.patience.toFixed(2)}, chance ${s.chanceOfPayoff.toFixed(2)}`;
      return `gave up after ${Math.round(s.waitedSeconds)} s (${why})`;
    },
    heldBack: (skill, now) => now < (waiting.get(skill)?.until ?? -Infinity),
    backstopMs: () => (strength > 0 ? OVER_PERSISTING_FACTOR : 1) * Math.max(baseMs, options.mostBaseMs ?? 0),
    status,
  };
}
