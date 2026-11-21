/** What the scorebook knows about one skill, in one situation, aimed at one thing: its adjustments put together. */
export interface ScoreEntry {
  /** How good the skill usually turns out here. Starts at 0. */
  expected: number;
  /** Learned benefit: grows with good surprises, shrinks with bad ones. Starts at 1. */
  benefit: number;
  /** Learned cost: grows with bad surprises, shrinks with good ones. Starts at 1. */
  cost: number;
  /** How many runs of the skill ended as done or failed, anywhere (interrupted ones are not counted). */
  runs: number;
  /** How many of those runs ended as done. */
  successes: number;
}

/** What a saved adjustment may also carry. */
interface Extras {
  /** How many runs with this as their most particular feature were cut short in a row, with no finished run between. */
  cutShort?: number;
}

/** What a skill is aimed at: its kind ("chest"), and which one if it is a thing that stays where it is. */
export interface Aim {
  kind: string;
  id?: string;
}

/** One saved adjustment: what one feature of a run (see `featuresOf`) adds. */
export interface SavedScore extends Omit<ScoreEntry, "runs" | "successes">, Partial<Pick<ScoreEntry, "runs" | "successes">>, Extras {
  feature: string;
}

/** The chance a skill works, from its record: successes over runs, starting from an even 0.5. */
export function chanceOfPayoff({ runs, successes }: Pick<ScoreEntry, "runs" | "successes">): number {
  return (successes + 1) / (runs + 2);
}

/** The feature for a skill in general. */
export const skillFeature = (skill: string) => skill;
/** The feature for what one label of the situation ("night", "hungry") adds to a skill. */
export const labelFeature = (skill: string, label: string) => `${skill} | ${label}`;
/** The feature for what aiming a skill at a kind of thing adds. */
export const kindFeature = (skill: string, kind: string) => `${skill} → ${kind}`;
/** The feature for what aiming a skill at one particular thing adds, beyond its kind. */
export const thingFeature = (skill: string, aim: Required<Aim>) => `${skill} → ${aim.kind} # ${aim.id}`;

/** The features of aiming a skill at a thing: its kind, and the thing itself if it has an id. */
function aimFeatures(skill: string, aim: Aim | undefined): string[] {
  if (!aim) return [];
  return [kindFeature(skill, aim.kind), ...(aim.id === undefined ? [] : [thingFeature(skill, { kind: aim.kind, id: aim.id })])];
}

/**
 * The features of one run, from the most general level to the most particular: the skill in
 * general; the skill under each label of the situation (a situation is its labels joined by "/");
 * the kind of thing it was aimed at; that thing itself.
 */
function levelsOf(situation: string, skill: string, aim?: Aim): string[][] {
  return [[skillFeature(skill)], situation.split("/").map((label) => labelFeature(skill, label)), ...aimFeatures(skill, aim).map((feature) => [feature])];
}

/** The most particular feature of a run, whatever the situation: the thing, else its kind, else the skill. */
const mostParticular = (skill: string, aim?: Aim) => aimFeatures(skill, aim).at(-1) ?? skillFeature(skill);

/** Every feature of one run (see `levelsOf`), in one list. */
export function featuresOf(situation: string, skill: string, aim?: Aim): string[] {
  return levelsOf(situation, skill, aim).flat();
}

/**
 * How good each skill usually turns out, learned from surprises. A skill's value is not kept on
 * one page per exact situation: it is the sum of small adjustments, one per feature of the run
 * (the skill in general, each label of the situation, the kind of thing it was aimed at, that
 * particular thing). So what is learned by day is known at night, less whatever night itself has
 * been found to change; a chest never visited starts from what chests are worth, and an empty
 * one gets its own adjustment. A new label adds one adjustment per skill, not a new set of pages.
 *
 * Each run teaches every level in turn, the most general first: a level takes one step of what
 * is still unexplained (the labels of a situation share their step equally), and the next level
 * learns from what is left. So the general levels soak up what is true everywhere and the
 * particular ones only what is different about them; and a run that turned out exactly as
 * expected teaches nothing at any level. With four levels a surprise moves the total about a
 * third of the way at a step of 0.1.
 *
 * The update follows the OpAL model (Collins & Frank 2014): with move = step × unexplained,
 *   expected += move                     (the adjustments add up)
 *   benefit  ×= 1 + move                 (benefits and costs multiply up)
 *   cost     ×= 1 − move
 * so a good surprise raises the benefit and lowers the cost, and a bad one does the opposite.
 * Benefit and cost never go below 0.
 */
export interface Scorebook {
  /** A skill's value in a situation, aimed at a thing if given: all its adjustments put together. */
  get(situation: string, skill: string, aim?: Aim): ScoreEntry;
  /** Only what aiming the skill at this thing adds (its kind, and the thing itself): 0, 1 and 1 if nothing was learned. */
  aimed(skill: string, aim: Aim): Pick<ScoreEntry, "expected" | "benefit" | "cost">;
  /** Learns from one finished skill run; returns the surprise. */
  learn(situation: string, skill: string, outcome: number, step: number, aim?: Aim): number;
  /** Counts one run of the skill that ended as done (succeeded) or failed. One that succeeded starts its count of unfinished runs in a row again. */
  record(situation: string, skill: string, succeeded: boolean, aim?: Aim): void;
  /**
   * Counts one more run that did not finish (interrupted, or failed), and returns how many had not finished in a row
   * before it. Kept for the most particular thing known about the run: that chest, else that
   * kind of thing, else the skill.
   */
  cutShort(skill: string, aim?: Aim): number;
  /** Every particular thing something has been learned about (each once): the bot's memory of places. */
  things(): Required<Aim>[];
  /** Every adjustment learned so far, for saving. */
  entries(): (SavedScore & ScoreEntry)[];
}

const FRESH: ScoreEntry = { expected: 0, benefit: 1, cost: 1, runs: 0, successes: 0 };

/** A scorebook, optionally filled from saved adjustments. */
export function createScorebook(saved: SavedScore[] = []): Scorebook {
  const book = new Map<string, SavedScore & ScoreEntry>();
  for (const entry of saved) book.set(entry.feature, { runs: 0, successes: 0, ...entry });

  /** The things learned about, read off the features; worked out again only when a feature is added. */
  let things: { of: number; list: Required<Aim>[] } = { of: -1, list: [] };

  /** The adjustment to update, created fresh if there is none yet. */
  function entryFor(feature: string) {
    if (!book.has(feature)) book.set(feature, { feature, ...FRESH });
    return book.get(feature)!;
  }

  /** Adjustments put together: expectations add, benefits and costs multiply. */
  function together(features: string[]): Pick<ScoreEntry, "expected" | "benefit" | "cost"> {
    let [expected, benefit, cost] = [0, 1, 1];
    for (const feature of features) {
      const entry = book.get(feature);
      if (!entry) continue;
      expected += entry.expected;
      benefit *= entry.benefit;
      cost *= entry.cost;
    }
    return { expected, benefit, cost };
  }

  return {
    get(situation, skill, aim) {
      const { runs, successes } = book.get(skillFeature(skill)) ?? FRESH;
      return { ...together(featuresOf(situation, skill, aim)), runs, successes };
    },
    aimed: (skill, aim) => together(aimFeatures(skill, aim)),
    learn(situation, skill, outcome, step, aim) {
      const levels = levelsOf(situation, skill, aim);
      const surprise = outcome - together(levels.flat()).expected;
      let unexplained = surprise;
      for (const level of levels) {
        const move = step * unexplained;
        for (const feature of level) {
          const entry = entryFor(feature);
          const share = move / level.length;
          entry.expected += share;
          entry.benefit = Math.max(0, entry.benefit * (1 + share));
          entry.cost = Math.max(0, entry.cost * (1 - share));
        }
        unexplained -= move;
      }
      return surprise;
    },
    record(_situation, skill, succeeded, aim) {
      const entry = entryFor(skillFeature(skill));
      entry.runs += 1;
      if (succeeded) entry.successes += 1;
      // Only a run that did its job starts the count of unfinished runs again: a failed one did not finish either.
      const particular = succeeded ? book.get(mostParticular(skill, aim)) : undefined;
      if (particular) delete particular.cutShort;
    },
    cutShort(skill, aim) {
      const entry = entryFor(mostParticular(skill, aim));
      const before = entry.cutShort ?? 0;
      entry.cutShort = before + 1;
      return before;
    },
    things() {
      if (things.of !== book.size) {
        const found = [...book.keys()].flatMap((feature) => {
          const [, kind, id] = / → (.+?) # (.+)$/.exec(feature) ?? [];
          return kind && id ? [[id, { kind, id }] as const] : [];
        });
        things = { of: book.size, list: [...new Map(found).values()] };
      }
      return things.list;
    },
    entries: () => [...book.values()].map((e) => ({ ...e })),
  };
}
