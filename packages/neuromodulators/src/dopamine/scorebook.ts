/** What the scorebook knows about one skill in one situation. */
export interface ScoreEntry {
  /** How good the skill usually turns out here. Starts at 0. */
  expected: number;
  /** Learned benefit: grows with good surprises, shrinks with bad ones. Starts at 1. */
  benefit: number;
  /** Learned cost: grows with bad surprises, shrinks with good ones. Starts at 1. */
  cost: number;
  /** How many runs ended as done or failed (interrupted ones are not counted). */
  runs: number;
  /** How many of those runs ended as done. */
  successes: number;
}

/** One saved scorebook entry. Files saved before runs were counted load with none. */
export interface SavedScore extends Omit<ScoreEntry, "runs" | "successes">, Partial<Pick<ScoreEntry, "runs" | "successes">> {
  situation: string;
  skill: string;
}

/** The chance a skill works, from its record: successes over runs, starting from an even 0.5. */
export function chanceOfPayoff({ runs, successes }: Pick<ScoreEntry, "runs" | "successes">): number {
  return (successes + 1) / (runs + 2);
}

/**
 * How good each skill usually turns out in each situation, learned from surprises. The update
 * follows the OpAL model (Collins & Frank 2014): with surprise = outcome - expected,
 *   expected += step * surprise
 *   benefit  += step * benefit * surprise
 *   cost     += step * cost * -surprise
 * so a good surprise raises the benefit and lowers the cost, and a bad one does the opposite.
 * Benefit and cost never go below 0.
 */
export interface Scorebook {
  get(situation: string, skill: string): ScoreEntry;
  /** Learns from one finished skill run; returns the surprise. */
  learn(situation: string, skill: string, outcome: number, step: number): number;
  /** Counts one run that ended as done (succeeded) or failed. */
  record(situation: string, skill: string, succeeded: boolean): void;
  /** Every entry learned so far, for saving. */
  entries(): (SavedScore & ScoreEntry)[];
}

const FRESH: ScoreEntry = { expected: 0, benefit: 1, cost: 1, runs: 0, successes: 0 };

/** A scorebook, optionally filled from saved entries. */
export function createScorebook(saved: SavedScore[] = []): Scorebook {
  const book = new Map<string, SavedScore & ScoreEntry>();
  const key = (situation: string, skill: string) => `${situation}\n${skill}`;
  for (const entry of saved) book.set(key(entry.situation, entry.skill), { runs: 0, successes: 0, ...entry });

  /** The entry to update, created fresh if there is none yet. */
  function entryFor(situation: string, skill: string) {
    const k = key(situation, skill);
    if (!book.has(k)) book.set(k, { situation, skill, ...FRESH });
    return book.get(k)!;
  }

  return {
    get(situation, skill) {
      const { expected, benefit, cost, runs, successes } = book.get(key(situation, skill)) ?? FRESH;
      return { expected, benefit, cost, runs, successes };
    },
    learn(situation, skill, outcome, step) {
      const entry = entryFor(situation, skill);
      const surprise = outcome - entry.expected;
      entry.expected += step * surprise;
      entry.benefit = Math.max(0, entry.benefit + step * entry.benefit * surprise);
      entry.cost = Math.max(0, entry.cost - step * entry.cost * surprise);
      return surprise;
    },
    record(situation, skill, succeeded) {
      const entry = entryFor(situation, skill);
      entry.runs += 1;
      if (succeeded) entry.successes += 1;
    },
    entries: () => [...book.values()].map((e) => ({ ...e })),
  };
}
