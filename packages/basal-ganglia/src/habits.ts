// Habits: how well-worn each choice is in each situation. A habit is one number, 0 to 1, for a
// skill in a situation; it grows a little with each win that ends well, falls sharply when one
// goes wrong, and fades slowly while unused. Game-free: situations and skills are only names.

export const HABIT = {
  /** Above this, the choice is made without asking. */
  strong: 0.8,
  /** Each win that ends well closes this share of the gap to 1. */
  grow: 0.15,
  /** What is left after a bad surprise or a failed skill. */
  fall: 0.5,
  /** What is left when the decider, asked, wanted something else. */
  disagree: 0.7,
  /** Unused, a habit halves in this long. */
  halfLifeMs: 2 * 60 * 60 * 1000,
};

export interface Habit {
  strength: number;
  /** What it was last aimed at (a kind of thing, a fixed thing, or a literal target), if anything. */
  aim?: string;
  /** The urgency the deciders gave it, averaged over its wins. */
  urgency: number;
  /** The need the body wanted most when it was last used, or null. */
  drive: string | null;
  usedAt: number;
  wins: number;
}

/** situation → skill → habit. */
export type HabitEntries = Record<string, Record<string, Habit>>;

export interface Habits {
  /** The habit as it stands now (faded by disuse), or null. */
  get(situation: string, skill: string, now: number): Habit | null;
  /** The strongest habit of a situation among the skills allowed, or null. */
  strongest(situation: string, now: number, allowed?: (skill: string) => boolean): { skill: string; habit: Habit } | null;
  /** A win that ended well. `rate` scales how much it grows (0 to 1). */
  won(situation: string, skill: string, use: { aim?: string | undefined; urgency: number; drive: string | null }, now: number, rate?: number): Habit;
  /** Something went wrong: what is left is `factor` of it. */
  fell(situation: string, skill: string, factor: number, now: number): Habit | null;
  /** Used again in this drive: the clock of disuse starts over. */
  used(situation: string, skill: string, drive: string | null, now: number): void;
  entries(): HabitEntries;
}

const faded = (habit: Habit, now: number): Habit => ({ ...habit, strength: habit.strength * 0.5 ** (Math.max(0, now - habit.usedAt) / HABIT.halfLifeMs) });

export function createHabits(initial: HabitEntries = {}): Habits {
  const entries: HabitEntries = structuredClone(initial);
  const get = (situation: string, skill: string, now: number) => {
    const habit = entries[situation]?.[skill];
    return habit ? faded(habit, now) : null;
  };
  return {
    get,
    strongest(situation, now, allowed = () => true) {
      let best: { skill: string; habit: Habit } | null = null;
      for (const skill of Object.keys(entries[situation] ?? {})) {
        const habit = get(situation, skill, now)!;
        if (allowed(skill) && (!best || habit.strength > best.habit.strength)) best = { skill, habit };
      }
      return best;
    },
    won(situation, skill, use, now, rate = 1) {
      const before = get(situation, skill, now) ?? { strength: 0, urgency: use.urgency, drive: use.drive, usedAt: now, wins: 0 };
      const habit: Habit = {
        strength: before.strength + HABIT.grow * rate * (1 - before.strength),
        ...(use.aim === undefined ? {} : { aim: use.aim }),
        urgency: before.wins ? before.urgency + (use.urgency - before.urgency) / Math.min(before.wins + 1, 5) : use.urgency,
        drive: use.drive,
        usedAt: now,
        wins: before.wins + 1,
      };
      (entries[situation] ??= {})[skill] = habit;
      return habit;
    },
    fell(situation, skill, factor, now) {
      const before = get(situation, skill, now);
      if (!before) return null;
      return (entries[situation]![skill] = { ...before, strength: before.strength * factor, usedAt: now });
    },
    used(situation, skill, drive, now) {
      const before = get(situation, skill, now);
      if (before) entries[situation]![skill] = { ...before, drive, usedAt: now };
    },
    entries: () => structuredClone(entries),
  };
}

/** The entries of a saved file that are well formed; anything else is left out. */
export function parseHabits(raw: unknown): HabitEntries {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const ok = (h: unknown): h is Habit => {
    const e = h as Partial<Habit> | null;
    return typeof e === "object" && e !== null && typeof e.strength === "number" && e.strength >= 0 && e.strength <= 1 && typeof e.urgency === "number" && typeof e.usedAt === "number" && typeof e.wins === "number" && (e.drive === null || typeof e.drive === "string") && (e.aim === undefined || typeof e.aim === "string");
  };
  const out: HabitEntries = {};
  for (const [situation, skills] of Object.entries(raw as Record<string, unknown>)) {
    if (skills === null || typeof skills !== "object") continue;
    const kept = Object.entries(skills as Record<string, unknown>).filter(([, h]) => ok(h)) as [string, Habit][];
    if (kept.length) out[situation] = Object.fromEntries(kept);
  }
  return out;
}
