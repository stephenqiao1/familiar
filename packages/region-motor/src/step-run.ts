import type { SkillEvent, Step } from "@familiar/contracts";

// What the motor area keeps about the step under way: how long it has been at it, and how often
// its skill has failed. Kept apart from the area so the three ways of being stuck can be read
// (and tested) on their own.

/** A step is stuck once its skill has failed this many times. */
export const MOST_FAILS = 3;
/** A step is stuck once its skill has run this many times its usual time. */
export const TIMES_USUAL = 3;
/** A step already reported stuck is reported again no sooner than this, however fast it fails: the planner needs time to answer. */
export const REPORT_AGAIN_MS = 30_000;
/** The usual time taken for a skill nothing has learned about yet, in ms. */
export const UNLEARNED_MS = 30_000;

export interface StepRun {
  /** Which step this is: its place in the goal and everything it says. */
  key: string;
  /** When the clock last started: the step began, its skill last started or ended, or it was last reported stuck. */
  since: number;
  fails: number;
  /** Why its skill last failed. */
  failedWith?: string;
  /** Events up to this time have been counted. */
  seenTo: number;
}

export const keyOf = (index: number, step: Step) => `${index}|${JSON.stringify(step)}`;

export const begin = (key: string, now: number): StepRun => ({ key, since: now, fails: 0, seenTo: now });

/** The run with the step's skill events since last time counted: a failure adds one, and a start or an end restarts the clock. */
export function counted(run: StepRun, step: Step, events: readonly SkillEvent[]): StepRun {
  const fresh = events.filter((e) => e.timestamp > run.seenTo && e.skill === step.skill && !e.alongside);
  if (!fresh.length) return run;
  const failed = fresh.filter((e) => e.type === "failed");
  const failedWith = failed.at(-1)?.reason ?? run.failedWith;
  const last = fresh.at(-1)!.timestamp;
  return { ...run, fails: run.fails + failed.length, ...(failedWith === undefined ? {} : { failedWith }), since: Math.max(run.since, last), seenTo: last };
}

/**
 * Why the step is stuck, or null: its "give up when" is true; its skill has failed three times;
 * its skill has run three times its usual time; or its skill has not got to run at all for that
 * long (it cannot start, or something else keeps winning). The usual time is the learned one, or
 * 30 s while none is learned. A skill that only rests (it uses no part of the body: waiting) is
 * never judged by time while it runs: waiting has no usual length.
 */
export function stuckWhy(run: StepRun, skill: string | null, now: number, facts: { giveUp: string | null; usualMs: number | null; running: boolean; rests?: boolean }): string | null {
  if (facts.giveUp !== null) return `give up when: ${facts.giveUp}`;
  if (!skill) return null;
  if (run.fails >= MOST_FAILS) return `${skill} failed ${run.fails} times${run.failedWith ? ` (${run.failedWith})` : ""}`;
  if (facts.running && facts.rests) return null;
  const usual = facts.usualMs ?? UNLEARNED_MS;
  const spent = now - run.since;
  if (spent <= TIMES_USUAL * usual) return null;
  const seconds = `${Math.round(spent / 1000)} s`;
  return facts.running ? `${skill} has run ${seconds}, over ${TIMES_USUAL} times its usual ${Math.round(usual / 100) / 10} s` : `${skill} has not got to run for ${seconds}`;
}
