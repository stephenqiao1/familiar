/** How the cerebellum learns. Every number is a first guess to tune in play. */
export interface CerebellumSettings {
  /** 0: learns nothing (the models stay as they are). 1: learns. */
  learn: number;
  /** A model is used once it has been seen this many times. */
  trusted: number;
  /** The share of each error the prediction moves by once the model is settled (a new one moves by 1 over its count). */
  settledRate: number;
  /** A model unused for this many ms starts to lose its count. */
  forgetAfterMs: number;
  /** From then on the count halves every this many ms, so the model is relearned quickly afterwards. */
  forgetHalfLifeMs: number;
  /** A change that follows at least this often is a learned expectation. */
  expectedAt: number;
  /** The lowest and highest value each measure may be learned as; a result outside is pulled in first. */
  bounds: Readonly<Record<string, readonly [number, number]>>;
  // The readers, each from 0 (the bot's fixed rule, as before the cerebellum) to 1 (the learned model in full).
  /** A journey's estimate from the learned pace on the ground it starts on. */
  estimates: number;
  /** A journey is late by the learned pace over the ground it crossed, plus three spreads. */
  late: number;
  /** The stumble check allows for the learned pace here. */
  pace: number;
  /** The give-up clock starts from the skill's own usual time. */
  giveUp: number;
  /** The `mismatch` signal: a movement that came out far from its prediction. */
  mismatch: number;
  /** Learned expectations stand in for an empty written list, and for a written one that experience disagrees with. */
  expectations: number;
  /** The delay of each "leads to" fact is learned, and what is due soon is told. */
  timing: number;
}

/** The names of the readers' strengths. */
export const READERS = ["estimates", "late", "pace", "giveUp", "mismatch", "expectations", "timing"] as const;
/** Every reader on the bot's fixed rule: learning in shadow. */
export const NO_READERS = { estimates: 0, late: 0, pace: 0, giveUp: 0, mismatch: 0, expectations: 0, timing: 0 };

export const DEFAULT_CEREBELLUM: CerebellumSettings = {
  learn: 1,
  trusted: 5,
  settledRate: 0.1,
  // A game day is 20 minutes: nothing is lost for one day, then half every three.
  forgetAfterMs: 20 * 60_000,
  forgetHalfLifeMs: 3 * 20 * 60_000,
  expectedAt: 0.9,
  bounds: {},
  estimates: 1,
  late: 1,
  pace: 1,
  giveUp: 1,
  mismatch: 1,
  expectations: 1,
  timing: 1,
};

/** What is wrong with a "cerebellum" settings block, or null. */
export function cerebellumProblem(s: CerebellumSettings): string | null {
  if (![s.learn, s.settledRate, s.expectedAt].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) return "learn, settledRate and expectedAt must each be from 0 to 1";
  const off = READERS.find((r) => !(Number.isFinite(s[r]) && s[r] >= 0 && s[r] <= 1));
  if (off) return `${off} must be from 0 to 1`;
  if (!Number.isFinite(s.trusted) || s.trusted < 1) return "trusted must be 1 or more";
  if (!Number.isFinite(s.forgetHalfLifeMs) || s.forgetHalfLifeMs <= 0 || !Number.isFinite(s.forgetAfterMs) || s.forgetAfterMs < 0) return "forgetHalfLifeMs must be above 0 and forgetAfterMs 0 or more";
  return null;
}
