import type { SkillEvent } from "@familiar/contracts";
import { giveUpFactor } from "./effects.js";

/** The most the running skill's score is raised to keep it going (when it has all its time left). */
export const MAX_STAY_BONUS = 0.15;
/** Guardrail: after this many times the base time on one skill with no success or progress, patience is ignored. */
const OVER_PERSISTING_FACTOR = 3;

/** Where the running skill stands against its give-up time, for the log. */
export interface PersistenceStatus {
  skill: string;
  /** Seconds since the skill started or last made progress. */
  waitedSeconds: number;
  giveUpSeconds: number;
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
 *   - Until the time is up, the skill gets a stay bonus that fades as the time runs out, so a
 *     challenger must be clearly better to take over.
 *   - When the time is up, the skill is given up on.
 */
export interface Persistence {
  /** Feed every skill event, in order. */
  observe(event: SkillEvent): void;
  /** The running skill made progress (e.g. earned a reward): its clock restarts. */
  progress(now: number): void;
  /** How much to raise this skill's score for being the one already running; 0 for any other. */
  stayBonus(skill: string, now: number): number;
  /** Why to give up on the running skill now, or null to keep going. */
  giveUpReason(now: number): string | null;
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
}): Persistence {
  const { patience, chanceOf, strength, baseMs = 120_000 } = options;
  let running: { skill: string; clockFrom: number } | null = null;
  /** Time spent on one skill, across back-to-back runs, since it last succeeded or made progress. */
  let streak = { skill: "", ms: 0 };

  function status(now: number): PersistenceStatus | null {
    if (!running) return null;
    const waited = now - running.clockFrom;
    const overPersisting = streak.ms + waited > OVER_PERSISTING_FACTOR * baseMs;
    const p = overPersisting ? 0.5 : patience();
    const chance = chanceOf(running.skill);
    const giveUpMs = baseMs * giveUpFactor(p, chance, strength);
    const left = Math.max(0, giveUpMs - waited);
    return {
      skill: running.skill,
      waitedSeconds: waited / 1000,
      giveUpSeconds: giveUpMs / 1000,
      patience: p,
      chanceOfPayoff: chance,
      stayBonus: strength * MAX_STAY_BONUS * (left / giveUpMs),
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
      const why = s.overPersisting ? "kept at it too long with no progress" : `patience ${s.patience.toFixed(2)}, chance ${s.chanceOfPayoff.toFixed(2)}`;
      return `gave up after ${Math.round(s.waitedSeconds)} s (${why})`;
    },
    backstopMs: () => (strength > 0 ? OVER_PERSISTING_FACTOR * baseMs : baseMs),
    status,
  };
}
