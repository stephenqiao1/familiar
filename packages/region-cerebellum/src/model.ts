// What the cerebellum keeps: for each movement in each situation, what it usually comes to.
// One model per (kind of movement, name, situation key). Plain data, saved as it is.

/** One measure of a movement (seconds taken, seconds per block): what is predicted, and how far off that usually is. */
export interface Estimate {
  value: number;
  /** The usual size of the error. */
  spread: number;
  /** How many runs it has been learned from (it shrinks while unused: see `sureOf`). */
  seen: number;
  /** When it was last updated, in ms. */
  at: number;
}

/** What one movement does in one situation. */
export interface Model {
  measures: Record<string, Estimate>;
  /** How many runs the changes were counted over, and how often each change followed. */
  runs: number;
  changes: Record<string, number>;
  at: number;
}

/** One movement as it ended: what it was, the situation it ran in, and what happened. */
export interface Movement {
  /** "primitive", "journey", "pace", "skill": only a label, the learning is the same for all. */
  kind: string;
  name: string;
  /** The situation, from the most specific key to the most general ("" = any situation). */
  keys: readonly string[];
  /** Numbers that say what happened (seconds, secondsPerBlock, ...). Left out: not measured this run. */
  measures: Readonly<Record<string, number>>;
  /** Which changes it caused ("targetBlock=air", "moved"). Left out: the changes were not watched. */
  changes?: readonly string[];
  /** When it ended, in ms. */
  at: number;
  /** It was cut short (stopped from outside, or the body was hurt meanwhile): it teaches nothing. */
  cutShort?: boolean;
  /** What the bot goes by today, for the log (the journey's own estimate, the written expectations). */
  today?: Readonly<Record<string, unknown>>;
}

export type Models = Record<string, Model>;

export interface ModelStore {
  get(id: string): Model | undefined;
  set(id: string, model: Model): void;
  ids(): string[];
  entries(): Models;
}

/** The name a model is filed under. */
export const modelId = (kind: string, name: string, key: string) => `${kind}:${name}${key ? `@${key}` : ""}`;

export function createModels(saved: Models = {}): ModelStore {
  const models = new Map(Object.entries(saved));
  return {
    get: (id) => models.get(id),
    set: (id, model) => void models.set(id, model),
    ids: () => [...models.keys()],
    entries: () => Object.fromEntries(models),
  };
}

const isEstimate = (e: unknown): e is Estimate => {
  const x = e as Estimate | null;
  return x !== null && typeof x === "object" && [x.value, x.spread, x.seen, x.at].every(Number.isFinite);
};

/** Whether a saved entry is a whole model (a broken one is left out on loading). */
export function isModel(m: unknown): m is Model {
  const x = m as Model | null;
  if (x === null || typeof x !== "object" || !Number.isFinite(x.runs) || !Number.isFinite(x.at)) return false;
  if (typeof x.measures !== "object" || x.measures === null || typeof x.changes !== "object" || x.changes === null) return false;
  return Object.values(x.measures).every(isEstimate) && Object.values(x.changes).every(Number.isFinite);
}
