import { goodOf, harmOf, LIMITS, safeHere, sureness, type Association, type AssociationStore } from "./association.js";
import type { AmygdalaSettings } from "./settings.js";

// Learning by surprise. The cues around before an outcome share one surprise: the outcome less
// what they already predicted together. So a cue that adds nothing to what was predicted learns
// nothing (the tag-along is not blamed), and a bigger outcome teaches faster. Harm is never
// erased, and a hurt never lowers it: it is unlearned by place, through "safe here", when the
// cue is around and nothing happens. Pure: no clock, no game.

/** A cue that is around right now. */
export interface CueNow {
  key: string;
  /** How much it stands out, 0 to 1 (the thing attended to stands out most). */
  salience: number;
  /** A cue that acts through one channel (a food, through the gut) is only blamed for outcomes that came through it. */
  through?: string;
  /** It harms only by contact (a block): it is blamed for a harm only when the harm points straight at it, never for being around. */
  direct?: boolean;
}

export interface Outcome {
  sign: "harm" | "good";
  /** 0 to 1: the share of health lost, or how far a need dropped. */
  size: number;
  /** In plain words, for the log ("lost 6 health to a zombie"). */
  what: string;
  /** Death: it teaches in one go. */
  final?: boolean;
  /** Cues the event itself points at (the attacker, the block the game names): they take most of the blame. */
  points?: string[];
  /** The channel it came through ("gut"), if it has one. */
  through?: string;
}

export interface Change {
  cue: string;
  what: "harm" | "good" | "safe";
  from: number;
  to: number;
}

export interface Moment {
  /** The area the bot is in (for "safe here"), or null if not known. */
  area: string | null;
  now: number;
  settings: AmygdalaSettings;
}

export const LEARNING = {
  /** The smallest outcome teaches at this share of the full rate; the largest at all of it. */
  slowest: 0.3,
  /** A cue the outcome does not point at, when it points at another, counts this much. */
  notPointedAt: 0.25,
  /** Each piece of evidence moves sureness this share of the way to 1; a harmless meeting, this share. */
  surer: 0.3,
  surerHarmless: 0.1,
  /** One harmless meeting moves "safe here" this share of the way to 1, if it lasted this long (less if shorter). */
  harmless: 0.1,
  fullMeetingMs: 20_000,
  /** A place is dangerous enough to teach a sign of safety when the other cues predict this much harm. */
  dangerousPlace: 0.2,
  /** A cue with nothing good following loses this share of the harmless step from its good. */
  goodFades: 0.5,
  /**
   * Each harmless meeting makes a cue that much slower to be blamed for a harm that points at
   * nothing: its weight is divided by 1 + this × meetings (counted up to `metMost`). So the ground
   * and the time of day, always there, give way to whatever is new.
   */
  familiar: 0.5,
  metMost: 20,
};

const clamp = (x: number, low: number, high: number) => Math.min(high, Math.max(low, x));
const blank = (now: number): Association => ({ harm: 0, good: 0, sure: 0, at: now });
const value = (a: Association | undefined, sign: Outcome["sign"], m: Moment) => (sign === "harm" ? harmOf(a, m.area, m.now, m.settings.safeHere) : goodOf(a, m.now));

/** What the cues predict together, 0 to 1. */
export function predict(store: AssociationStore, cues: readonly CueNow[], sign: Outcome["sign"], m: Moment): number {
  return clamp(cues.reduce((sum, c) => sum + value(store.get(c.key), sign, m), 0), 0, 1);
}

/** Notes fresh evidence: sureness is brought up to date, then raised. */
function evidence(a: Association, now: number, step: number): void {
  const sure = sureness(a, now);
  a.sure = sure + (1 - sure) * step;
  a.at = now;
}

/** Lowers the harm a cue expresses in this area by `amount`, through "safe here" (the harm itself stays). */
function calm(a: Association, area: string | null, amount: number, m: Moment): Change | null {
  if (m.settings.safeHere <= 0 || area === null || a.harm <= 0) return null;
  const was = a.safe?.[area];
  const from = was ? was.value * 0.5 ** (Math.max(0, m.now - was.at) / LIMITS.safeHalfLifeMs) : 0;
  const to = clamp(from + amount, 0, 1);
  a.safe = { ...a.safe, [area]: { value: to, at: m.now } };
  return { cue: "", what: "safe", from, to };
}

/** Something happened: the cues around share the surprise. Returns what was predicted and what changed. */
export function learnOutcome(store: AssociationStore, cues: readonly CueNow[], outcome: Outcome, m: Moment): { predicted: number; surprise: number; changes: Change[] } {
  const pointed = new Set(outcome.points ?? []);
  const around = cues.filter((c) => (!c.through || c.through === outcome.through) && (outcome.sign !== "harm" || !c.direct || pointed.has(c.key)));
  const predicted = predict(store, around, outcome.sign, m);
  const surprise = outcome.size - predicted;
  const rate = m.settings.learn <= 0 ? 0 : outcome.final ? 1 : Math.min(1, m.settings.learn * (LEARNING.slowest + (1 - LEARNING.slowest) * outcome.size));
  const anyPointed = around.some((c) => pointed.has(c.key));
  // Long familiar and harmless: slow to be blamed for harm (unless the harm points straight at it).
  const novelty = (c: CueNow) => (outcome.sign === "harm" ? 1 / (1 + LEARNING.familiar * (store.get(c.key)?.met ?? 0)) : 1);
  const weight = (c: CueNow) => (pointed.has(c.key) ? Math.max(1, c.salience) : c.salience * (anyPointed ? LEARNING.notPointedAt : 1) * novelty(c));
  const total = around.reduce((sum, c) => sum + weight(c), 0);
  const changes: Change[] = [];
  if (rate <= 0 || total <= 0) return { predicted, surprise, changes };

  for (const c of around) {
    const a = store.get(c.key) ?? blank(m.now);
    const share = weight(c) / total;
    // With sharing off, each cue is surprised by the outcome on its own.
    const own = outcome.size - clamp(value(a, outcome.sign, m), 0, 1);
    const step = rate * share * (own + (surprise - own) * m.settings.surprise);
    if (outcome.sign === "good") {
      const to = clamp(a.good + step, 0, 1);
      if (to !== a.good) changes.push({ cue: c.key, what: "good", from: a.good, to });
      a.good = to;
    } else if (step >= 0) {
      const to = clamp(a.harm + step, LIMITS.safest, 1);
      if (to !== a.harm) changes.push({ cue: c.key, what: "harm", from: a.harm, to });
      a.harm = to;
      // What the harm points at is no longer something familiar and harmless.
      if (pointed.has(c.key)) delete a.met;
      // Hurt here after all: this place is that much less safe for it.
      const safe = m.area === null ? undefined : a.safe?.[m.area];
      if (safe && safe.value > 0) {
        const less = safe.value * (1 - rate * share);
        changes.push({ cue: c.key, what: "safe", from: safe.value, to: less });
        a.safe![m.area!] = { value: less, at: m.now };
      }
    }
    // (Harm smaller than expected changes nothing: being hurt is never evidence of safety.)
    evidence(a, m.now, LEARNING.surer * Math.min(1, share * 3));
    store.set(c.key, a);
  }
  return { predicted, surprise, changes };
}

/**
 * A cue was around for `ms` and no harm came. A feared cue becomes that much safer here; one
 * not feared, in a place the other cues call dangerous, becomes a sign of safety (by its share
 * of how much everything around stands out, so only a cue that is reliably there gets far);
 * and the good a cue promised fades a little. `others`: the cues around now.
 */
export function learnHarmless(store: AssociationStore, met: { key: string; ms: number; salience: number }, others: readonly CueNow[], m: Moment): Change[] {
  const { key } = met;
  const a = store.get(key);
  const rate = m.settings.learn * LEARNING.harmless * Math.min(1, met.ms / LEARNING.fullMeetingMs);
  if (!a || rate <= 0) return [];
  a.met = Math.min(LEARNING.metMost, (a.met ?? 0) + Math.min(1, met.ms / LEARNING.fullMeetingMs));
  const changes: Change[] = [];
  const rest = others.filter((c) => c.key !== key);
  if (harmOf(a, m.area, m.now, m.settings.safeHere) > 0) {
    const change = calm(a, m.area, (1 - safeHere(a, m.area, m.now)) * rate, m);
    if (change) changes.push({ ...change, cue: key });
  } else {
    const danger = predict(store, rest, "harm", m);
    if (danger >= LEARNING.dangerousPlace) {
      const share = met.salience / (met.salience + rest.reduce((sum, c) => sum + c.salience, 0) || 1);
      const to = clamp(a.harm - rate * share * danger, LIMITS.safest, 1);
      if (to !== a.harm) changes.push({ cue: key, what: "harm", from: a.harm, to });
      a.harm = to;
    }
  }
  if (a.good > 0) {
    const to = a.good * (1 - rate * LEARNING.goodFades);
    changes.push({ cue: key, what: "good", from: a.good, to });
    a.good = to;
  }
  if (changes.length) evidence(a, m.now, LEARNING.surerHarmless);
  store.set(key, a);
  return changes;
}
