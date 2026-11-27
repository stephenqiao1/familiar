import type { BodyPart, Changes } from "@familiar/contracts";

// The body's own note of each movement it made: what it was, the situation it began in, how long
// it took and what it changed. The primitives and the locomotion controller write here as each
// movement ends, also for a movement made inside a longer skill (a hit in a fight, a stretch of
// a journey), which no skill event reports. The cerebellum reads it once a tick. Nothing here
// decides anything.

/** The physical situation a movement began in. Only what the body can sense at that moment. */
export interface MovementFacts {
  /** What it was aimed at: a block's type or a creature's kind. */
  aim?: string;
  /** What was in the hand (null: nothing). */
  hand?: string | null;
  /** The block that held the body up, and how such a block behaves (solid, slow, slippery, loose, liquid, climbing, none). */
  ground?: string;
  surface?: string;
  inWater?: boolean;
  sneaking?: boolean;
  /** A status effect that changes the body's own pace: "slowness" or "speed". */
  body?: string;
  /** For travel: how fast the legs were going, and whether the stretch climbed or dropped. */
  gait?: string;
  slope?: "up" | "down";
  /** For a stretch of travel: the pattern it was covered in (walk, swim, dash). */
  pattern?: string;
}

export interface MovementNote {
  /** A built-in movement, a whole journey, or one stretch of a journey over one kind of ground. */
  kind: "primitive" | "journey" | "pace";
  name: string;
  status: "done" | "failed" | "interrupted";
  seconds: number;
  /** When it ended, in ms. */
  at: number;
  facts: MovementFacts;
  /** The body parts it used (a primitive's). */
  parts?: readonly BodyPart[];
  /** What it changed, if that was watched. */
  changes?: Changes;
  /** More numbers that say what happened (seconds per block, recoveries). */
  measures?: Record<string, number>;
  /** The body lost health while it ran. */
  hurt?: boolean;
  /** What the bot goes by today for this movement (the written expectations, the journey's estimate). */
  today?: Record<string, unknown>;
}

/** No more than this many notes wait to be read (a brain that is not listening must not fill the memory). */
const MOST = 200;
const logs = new WeakMap<object, MovementNote[]>();

/** Gives a bot a movement log. Without one nothing is noted. */
export function keepMovements(bot: object): void {
  if (!logs.has(bot)) logs.set(bot, []);
}

export const keepsMovements = (bot: object) => logs.has(bot);

/** Notes one movement that just ended. */
export function noteMovement(bot: object, note: MovementNote): void {
  const log = logs.get(bot);
  if (!log) return;
  log.push(note);
  if (log.length > MOST) log.shift();
}

/** Takes the notes made since this was last asked, oldest first. */
export function takeMovements(bot: object): MovementNote[] {
  return logs.get(bot)?.splice(0) ?? [];
}

/** What a movement is checked against instead of its written expectations: whether the changes met it, the list, and why it is used. */
export interface LearnedCheck {
  expects: readonly string[];
  met(changes: Changes): boolean;
  why: string;
}
type Expecting = (name: string, facts: MovementFacts, parts: readonly BodyPart[], written: readonly string[]) => LearnedCheck | null;
const expecting = new WeakMap<object, Expecting>();
/** Lets something that has learned what the bot's movements do (the cerebellum) say what to expect of one. */
export function setLearnedExpectations(bot: object, ask: Expecting): void {
  expecting.set(bot, ask);
}
/** The learned expectations for this movement here, or null to go by the written ones. */
export const learnedCheck: (bot: object, ...asked: Parameters<Expecting>) => LearnedCheck | null = (bot, ...asked) => expecting.get(bot)?.(...asked) ?? null;
