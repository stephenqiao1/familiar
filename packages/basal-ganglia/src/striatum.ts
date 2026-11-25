import type { Candidate, Proposal, Region, Workspace } from "@familiar/contracts";
import type { Choice } from "./basal-ganglia.js";
import { mostUrgent } from "./choose.js";
import { createHabitLearning } from "./habit-learning.js";
import { HABIT, type Habits } from "./habits.js";
import { CONFLICT_SIGNAL, HABIT_SIGNAL } from "./signals.js";
import { skillOf } from "./term.js";

/** While a habit is acted on, the decider is still asked at least this often, in ms. */
export const SUPERVISE_MS = 5000;

export interface StriatumOptions {
  habits: Habits;
  /** How fast habits form, 0 to 1 (0: none form and none are used). */
  strength: number;
  /** How far a habit ignores a change in what the body wants most, 0 to 1. Default: 0. */
  blind?: number;
  /** The situation a habit belongs to (the scorebook's key). */
  situationOf(ws: Workspace): string;
  /** How a target is filed, so that a habit can be aimed at another thing of the same kind. Default: the target itself. */
  aimOf?(target: string, ws: Workspace): string;
  /** What to aim at now for a remembered aim, or null with nothing to aim at. Default: the aim itself. */
  targetFor?(aim: string, ws: Workspace): string | null;
  /** A skill that is never a habit. Default: none. */
  risky?(skill: string): boolean;
  /** Why this is no moment to act without asking (a threat, something striking, a safety need, predictions failing), or null. Asked every tick. Default: never. */
  notable?(ws: Workspace): string | null;
  /** The need the body wants most, or null. Default: never any. */
  topDrive?(ws: Workspace): string | null;
  /** Something just went worse than expected. Default: never. */
  badSurprise?(ws: Workspace): boolean;
  /** Whether a candidate is an answer of the decider a habit stands in for. Default: any from the region "instinct". */
  asked?(candidate: Candidate): boolean;
  /** Told each time a habit is taken up, broken or corrected. Default: nobody. */
  onNote?(line: string): void;
  /** Default: "striatum". */
  name?: string;
}

export interface Striatum {
  region: Region;
  /** Told what each choice came to: who won (habits grow from wins) and what the decider said when asked. */
  observe(choice: Choice, ws: Workspace): void;
  counts(): { used: number; saved: number; broken: number; wrong: number; asked: number };
}

/**
 * The striatum: well-worn choices become habits, so the decider is asked less. It watches who
 * wins; a choice of a deciding layer that keeps ending well in a situation (or keeps going with
 * nothing going wrong) grows into a habit,
 * and above 0.8, with nothing notable going on, the striatum proposes the action itself and
 * shares `habit`, which pauses the decider. The decider is still asked every few seconds, and a
 * different answer lowers the habit.
 */
export function createStriatum(options: StriatumOptions): Striatum {
  const { habits, strength, blind = 0, situationOf, aimOf = (target) => target, targetFor = (aim) => aim, risky = () => false, topDrive = () => null, asked = (c) => c.region === "instinct", name = "striatum" } = options;
  const counts = { used: 0, saved: 0, broken: 0, wrong: 0, asked: 0 };
  const say = (line: string) => options.onNote?.(line);
  const learning = createHabitLearning({ habits, strength, situationOf, aimOf, topDrive, ...(options.badSurprise ? { badSurprise: options.badSurprise } : {}), own: name, say });
  let askedAt = -Infinity;
  /** The habit proposed this tick, and the one acted on last tick. */
  let proposed: { situation: string; skill: string; aim: string | undefined } | null = null;
  let inUse: string | null = null;

  const region: Region = {
    name,
    layer: 0,
    everyMs: 0,
    run(ws) {
      if (strength <= 0) return { proposals: [] };
      const now = ws.state.timestamp;
      learning.learn(ws, now);
      const notable = options.notable?.(ws) ?? null;
      const situation = situationOf(ws);
      const best = habits.strongest(situation, now, (skill) => !risky(skill));
      proposed = null;
      const strong = best !== null && best.habit.strength > HABIT.strong;
      const drive = topDrive(ws);
      const target = strong && best.habit.aim !== undefined ? targetFor(best.habit.aim, ws) : undefined;
      // Nothing notable: no near tie, nothing the bot's own senses and needs flag, the same drive as when the habit was last used.
      const why = !strong
        ? null
        : (ws.signals[CONFLICT_SIGNAL]?.value ?? 0) > 0
          ? "a near tie"
          : (notable ?? (drive !== best.habit.drive && best.habit.strength * blind < HABIT.strong ? `the body wants ${drive ?? "nothing"} now, not ${best.habit.drive ?? "nothing"}` : target === null ? "nothing to aim it at" : null));
      const use = strong && why === null;
      if (inUse && (!use || inUse !== best.skill)) {
        counts.broken++;
        say(`habit ${inUse} broken: ${why ?? (strong ? `${best.skill} is the habit here` : "no strong habit in this situation")}`);
      }
      if (use && inUse !== best.skill) say(`habit ${best.skill} taken up (strength ${best.habit.strength.toFixed(2)}, ${best.habit.wins} wins in ${situation})`);
      inUse = use ? best.skill : null;
      const trace = { situation, ...(best ? { habit: { skill: best.skill, strength: Math.round(best.habit.strength * 1000) / 1000, wins: best.habit.wins } } : {}), use, ...(why ? { why } : {}), ...counts };
      if (!use) {
        ws.setSignal(HABIT_SIGNAL, 0);
        return { proposals: [], trace };
      }
      // Supervision: every few seconds the decider is asked all the same (the habit still proposes meanwhile).
      const asking = now - askedAt >= SUPERVISE_MS;
      counts.used++;
      if (!asking) counts.saved++;
      ws.setSignal(HABIT_SIGNAL, asking ? 0 : best.habit.strength);
      habits.used(situation, best.skill, drive, now);
      proposed = { situation, skill: best.skill, aim: best.habit.aim };
      const proposal: Proposal = { action: { skill: best.skill, ...(target == null ? {} : { target }) }, urgency: best.habit.urgency, reason: `habit (strength ${best.habit.strength.toFixed(2)}, ${best.habit.wins} wins here)` };
      return { proposals: [proposal], trace: { ...trace, asking, ...counts } };
    },
  };

  return {
    region,
    observe(choice, ws) {
      if (strength <= 0) return;
      const now = ws.state.timestamp;
      const answer = mostUrgent(choice.candidates.filter((c) => asked(c) && skillOf(c) !== null));
      if (answer) {
        askedAt = now;
        counts.asked++;
        const target = "target" in answer.action ? answer.action.target : undefined;
        const other = proposed && (skillOf(answer) !== proposed.skill || (target !== undefined && proposed.aim !== undefined && aimOf(target, ws) !== proposed.aim));
        if (proposed && other) {
          counts.wrong++;
          habits.fell(proposed.situation, proposed.skill, HABIT.disagree, now);
          say(`habit ${proposed.skill} weakened: asked, the decider wanted ${skillOf(answer)}${target === undefined ? "" : ` ${target}`}`);
        }
      }
      learning.follow(choice.winner, ws, now);
    },
    counts: () => ({ ...counts }),
  };
}
