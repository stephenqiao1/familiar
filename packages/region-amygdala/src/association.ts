// What the amygdala keeps: for each cue (a kind of thing, a block, a food, an area, a time of
// day, a sound, a sign) how strongly it predicts harm and good, how sure that is, and where it
// has been found safe. Game-free: a cue is a name. Every number is a first guess.

export interface Association {
  /** How strongly it predicts harm, -0.5 (a sign of safety) to 1. */
  harm: number;
  /** How strongly it predicts good, 0 to 1. */
  good: number;
  /** How sure, 0 to 1 (as of `at`: it fades from there). */
  sure: number;
  /** When evidence last came in, in ms. */
  at: number;
  /** "Safe here": area → how fully its harm has been found not to come there (0 to 1), and when. */
  safe?: Record<string, { value: number; at: number }>;
  /** How many times it has been around with no harm following (up to a limit): something long familiar and harmless is slow to be blamed. */
  met?: number;
  /** What it started from, if it was born with it: an unsure association falls back to this. */
  born?: { harm: number; good: number };
  /** If it started from a similar cue: which one. */
  from?: string;
}

export type Associations = Record<string, Association>;

export const LIMITS = {
  /** A sign of safety goes no lower than this. */
  safest: -0.5,
  /** With no sureness at all, a learned value is expressed this strongly. */
  unsure: 0.4,
  /** Sureness halves in this long without evidence: 5 game days. */
  sureHalfLifeMs: 6_000_000,
  /** "Safe here" halves in this long: 3 game days. */
  safeHalfLifeMs: 3_600_000,
  /** A "safe" learned in another area counts this much here. */
  safeElsewhere: 1 / 3,
};

const faded = (value: number, since: number, now: number, halfLife: number) => value * 0.5 ** (Math.max(0, now - since) / halfLife);

/** How sure an association is right now. */
export const sureness = (a: Association, now: number) => faded(a.sure, a.at, now, LIMITS.sureHalfLifeMs);

/** How safe a cue has been found in this area, 0 to 1: its own "safe here", or a third of the best from elsewhere. `strength` 0: never. */
export function safeHere(a: Association, area: string | null, now: number, strength = 1): number {
  let [here, elsewhere] = [0, 0];
  for (const [where, s] of Object.entries(a.safe ?? {})) {
    const value = faded(s.value, s.at, now, LIMITS.safeHalfLifeMs);
    if (where === area) here = value;
    else elsewhere = Math.max(elsewhere, value);
  }
  return Math.min(1, Math.max(here, elsewhere * LIMITS.safeElsewhere)) * strength;
}

/** A learned value as it is acted on: an unsure one falls back toward what the cue was born with. */
function weighed(value: number, born: number, a: Association, now: number): number {
  return born + (value - born) * (LIMITS.unsure + (1 - LIMITS.unsure) * sureness(a, now));
}

/** The harm a cue predicts here and now: what was learned, less where it has been found safe. */
export function harmOf(a: Association | undefined, area: string | null, now: number, safeStrength = 1): number {
  if (!a) return 0;
  const raw = weighed(a.harm, a.born?.harm ?? 0, a, now);
  return raw > 0 ? raw * (1 - safeHere(a, area, now, safeStrength)) : raw;
}

/** The good a cue predicts now. */
export const goodOf = (a: Association | undefined, now: number) => (a ? Math.max(0, weighed(a.good, a.born?.good ?? 0, a, now)) : 0);

/** What a cue is about: the part of its name before the colon ("kind", "block", "food", "area"). */
export const typeOf = (key: string) => key.slice(0, Math.max(0, key.indexOf(":")));

export interface AssociationStore {
  get(key: string): Association | undefined;
  set(key: string, a: Association): void;
  keys(): string[];
  /** For saving. */
  entries(): Associations;
}

export function createAssociations(saved: Associations = {}): AssociationStore {
  const all = new Map(Object.entries(saved).map(([key, a]) => [key, structuredClone(a)]));
  return {
    get: (key) => all.get(key),
    set: (key, a) => void all.set(key, a),
    keys: () => [...all.keys()],
    entries: () => Object.fromEntries([...all].map(([key, a]) => [key, structuredClone(a)])),
  };
}

/** Whether a saved entry is a usable association. */
export function isAssociation(a: unknown): a is Association {
  const o = a as Partial<Association> | null;
  const num = (n: unknown, low: number) => typeof n === "number" && n >= low && n <= 1;
  return o !== null && typeof o === "object" && num(o.harm, LIMITS.safest) && num(o.good, 0) && num(o.sure, 0) && Number.isFinite(o.at);
}
