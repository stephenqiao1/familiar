import type { Candidate, Workspace } from "@familiar/contracts";
import { HABIT, type Habits } from "./habits.js";
import { skillOf } from "./term.js";

/** A choice still under way with nothing gone wrong counts as a win each time this long passes (a skill that never ends can be a habit too). */
export const STILL_GOING_MS = 5000;

export interface HabitLearningOptions {
  habits: Habits;
  /** How fast habits form, 0 to 1. */
  strength: number;
  situationOf(ws: Workspace): string;
  aimOf(target: string, ws: Workspace): string;
  topDrive(ws: Workspace): string | null;
  badSurprise?(ws: Workspace): boolean;
  /** The striatum's own region name: its wins are followed like a decider's. */
  own: string;
  say(line: string): void;
}

/** The choice being followed to its end: whose it was, where it was made, and whether anything went wrong. */
interface Tracking {
  situation: string;
  skill: string;
  target: string | undefined;
  aim: string | undefined;
  /** The urgency the decider gave it (null for the habit's own proposal, which keeps what it had). */
  urgency: number | null;
  startedAt: number;
  creditedAt: number;
  bad: boolean;
}

/**
 * How habits are learned: the choice of a deciding layer (or of a habit) is followed while it
 * has the body. It is a win when it ends "done", and each few seconds it is still under way,
 * as long as no bad surprise came. A failed skill or a bad surprise weakens the habit sharply.
 */
export function createHabitLearning({ habits, strength, situationOf, aimOf, topDrive, badSurprise, own, say }: HabitLearningOptions) {
  let tracking: Tracking | null = null;
  let seenUntil = -Infinity;
  const win = (t: Tracking, ws: Workspace, now: number) => habits.won(t.situation, t.skill, { aim: t.aim, urgency: t.urgency ?? habits.get(t.situation, t.skill, now)?.urgency ?? 0, drive: topDrive(ws) }, now, strength);
  return {
    /** Learns from how the choice under way ended, from how long it has gone well, and from a bad surprise while it ran. */
    learn(ws: Workspace, now: number): void {
      for (const event of ws.recentEvents) {
        if (event.timestamp <= seenUntil || event.alongside || event.type === "started") continue;
        if (!tracking || event.skill !== tracking.skill || event.timestamp < tracking.startedAt) continue;
        if (event.type === "done" && !tracking.bad) win(tracking, ws, now);
        if (event.type === "failed" && habits.fell(tracking.situation, tracking.skill, HABIT.fall, now)) say(`habit ${tracking.skill} weakened: the skill failed (${event.reason ?? "no reason"})`);
        tracking = null;
      }
      seenUntil = Math.max(seenUntil, ...ws.recentEvents.map((e) => e.timestamp));
      // Still the choice, and nothing has gone wrong: that is a win as well, every few seconds.
      if (tracking && !tracking.bad && now - tracking.creditedAt >= STILL_GOING_MS) {
        win(tracking, ws, now);
        tracking.creditedAt = now;
      }
      if (tracking && !tracking.bad && badSurprise?.(ws)) {
        tracking.bad = true;
        if (habits.fell(tracking.situation, tracking.skill, HABIT.fall, now)) say(`habit ${tracking.skill} weakened: a bad surprise`);
      }
    },
    /** Whose choice has the body now: a decider's or a habit's is followed to its end; a reflex's is not a habit in the making. */
    follow(winner: Candidate | null, ws: Workspace, now: number): void {
      const skill = winner ? skillOf(winner) : null;
      if (!winner || skill === null) return;
      const target = "target" in winner.action ? winner.action.target : undefined;
      if (winner.region !== own && winner.layer < 1) tracking = null;
      else if (!tracking || tracking.skill !== skill || tracking.target !== target) tracking = { situation: situationOf(ws), skill, target, aim: target === undefined ? undefined : aimOf(target, ws), urgency: winner.region === own ? null : winner.urgency, startedAt: now, creditedAt: now, bad: false };
    },
  };
}
