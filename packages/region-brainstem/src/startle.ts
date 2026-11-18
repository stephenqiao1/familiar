import { createHabituation } from "./habituation.js";

// The size of a startle. Plain numbers in, plain numbers out: nothing here knows about any game.
//
//   magnitude = intensity × potentiation × (1 − warning) × (1 − habituated) × the bot's strength
//
// clamped to 0..1, and 0 for something the body did itself.

/** Below this there is no startle at all; from here a flinch; above `FULL` a full startle. */
export const FLINCH = 0.25;
export const FULL = 0.6;
/** How big each factor can get. */
export const LIMITS = { potentiation: 1.6, warning: 0.8, habituated: 0.9, whileHurt: 0.5 };
/** A full startle's hold runs from here to here as magnitude goes from `FULL` to 1. */
const HOLD_MS = { from: 250, to: 500 };
/** How much each thing adds to potentiation at full strength (the sum is capped at 0.6). */
const POTENTIATES = { alarm: 0.3, sore: 0.2, dark: 0.15, badPlace: 0.15 };
/** The same kind of event from the same place counts half as much each time nothing bad follows. */
const HABITUATION_STEP = 0.5;
/** No second startle within this long of one. */
export const REFRACTORY_MS = 1000;
/** Harm within this long of a startle means it was right to startle. */
const HARM_FOLLOWS_MS = 3000;
/** A weaker event of the same kind from the same place this recently is a warning. */
const PREPULSE_MS = 500;

const clamp = (n: number, low = 0, high = 1) => Math.min(high, Math.max(low, Number.isFinite(n) ? n : 0));

/** What state the body is in, each 0 to 1. */
export interface Edge {
  alarm: number;
  sore: number;
  /** How dark it is here. */
  dark: number;
  /** How strongly this place is remembered as bad. */
  badPlace: number;
}

/** How much being on edge enlarges a startle: 1 (calm, in the light, somewhere safe) to 1.6. `strength` scales the effect. */
export function potentiationOf(edge: Edge, strength = 1): number {
  const added = POTENTIATES.alarm * clamp(edge.alarm) + POTENTIATES.sore * clamp(edge.sore) + POTENTIATES.dark * clamp(edge.dark) + POTENTIATES.badPlace * clamp(edge.badPlace);
  return 1 + clamp(strength) * Math.min(LIMITS.potentiation - 1, added);
}

export interface Factors {
  /** How sudden and strong the event was, 0 to 1. */
  intensity: number;
  /** 1 to 1.6. */
  potentiation: number;
  /** How far it was seen coming, 0 to 0.8. */
  warning: number;
  /** How used to it the body is, 0 to 0.9. */
  habituated: number;
  /** The body did it itself. */
  selfCaused: boolean;
  /** Health dropped on this tick: damping is capped, so an event that is hurting right now is never silenced. */
  hurtNow: boolean;
  /** The bot's own strength: 0 never startles, 1 normal, up to 1.5 jumpy. */
  gain: number;
}

/** The size of the startle, 0 to 1. */
export function magnitudeOf(f: Factors): number {
  if (f.selfCaused) return 0;
  const cap = (n: number, limit: number) => clamp(n, 0, f.hurtNow ? Math.min(limit, LIMITS.whileHurt) : limit);
  return clamp(clamp(f.intensity) * clamp(f.potentiation, 1, LIMITS.potentiation) * (1 - cap(f.warning, LIMITS.warning)) * (1 - cap(f.habituated, LIMITS.habituated)) * Math.max(0, f.gain));
}

/** What the body does for a startle of this size. */
export function sizeOf(magnitude: number): "none" | "flinch" | "full" {
  return magnitude < FLINCH ? "none" : magnitude <= FULL ? "flinch" : "full";
}

/** How long a full startle holds, in ms: 250 at the threshold, 500 at the top. */
export function holdMsOf(magnitude: number): number {
  return Math.round(HOLD_MS.from + (HOLD_MS.to - HOLD_MS.from) * clamp((magnitude - FULL) / (1 - FULL)));
}

/** One sudden event, as the tracker takes it. */
export interface StartleEvent {
  /** What kind of event ("explosion", "hurt:fall", "zombie"). Habituation is per kind and place, never global. */
  kind: string;
  /** Roughly where it came from, or nothing for an event that travels with the body. */
  place?: string;
  intensity: number;
  /** It was seen coming (the source was attended, or in view and approaching, in the last 2 seconds): 0 to 1. */
  foreseen?: number;
  selfCaused?: boolean;
}

export interface StartleStrengths {
  /** Multiplies the magnitude: 0 never startles, 1 normal, up to 1.5 jumpy. */
  startle: number;
  potentiation: number;
  warning: number;
  habituation: number;
  selfCaused: number;
}

export interface Judged {
  magnitude: number;
  size: "none" | "flinch" | "full";
  potentiation: number;
  warning: number;
  habituated: number;
  selfCaused: boolean;
  /** Why there was no startle, if there was none. */
  silenced?: "self-caused" | "refractory" | "too small";
}

export interface Startle {
  /** Judges this tick's strongest event. `hurtNow`: health dropped on this tick. */
  judge(event: StartleEvent, edge: Edge, hurtNow: boolean, now: number): Judged;
  /** Health dropped: a startle in the last 3 seconds over something else was right, so that thing is no longer one to be used to. */
  harmed(now: number, by?: StartleEvent): void;
}

/** Keeps what a startle circuit remembers between events: what it is used to, what it just heard, and when it last fired. */
export function createStartle(strengths: StartleStrengths): Startle {
  const habituation = createHabituation(HABITUATION_STEP);
  let recent: { key: string; intensity: number; at: number }[] = [];
  let fired: { keys: string[]; at: number }[] = [];
  let lastAt = -Infinity;
  const keysOf = (e: StartleEvent) => [`${e.kind}${e.place ? ` at ${e.place}` : ""}`];

  return {
    judge(event, edge, hurtNow, now) {
      const keys = keysOf(event);
      recent = recent.filter((r) => now - r.at <= PREPULSE_MS);
      const prepulse = recent.some((r) => r.key === keys[0] && r.intensity < event.intensity);
      recent.push({ key: keys[0]!, intensity: event.intensity, at: now });

      const potentiation = potentiationOf(edge, strengths.potentiation);
      const warning = clamp(strengths.warning) * LIMITS.warning * Math.max(clamp(event.foreseen ?? 0), prepulse ? 1 : 0);
      const habituated = clamp(strengths.habituation) * Math.min(LIMITS.habituated, 1 - habituation.factor(keys, now));
      const selfCaused = (event.selfCaused ?? false) && strengths.selfCaused > 0;
      const magnitude = magnitudeOf({ intensity: event.intensity, potentiation, warning, habituated, selfCaused, hurtNow, gain: strengths.startle });
      const size = sizeOf(magnitude);
      const judged = { magnitude, potentiation, warning, habituated, selfCaused };
      if (selfCaused) return { ...judged, size: "none", silenced: "self-caused" };
      if (size === "none") {
        // A repeat the body is already used to keeps it used to it, even though it no longer startles.
        if (habituated > 0 && event.intensity >= FLINCH) habituation.damp(keys, now);
        return { ...judged, size, silenced: "too small" };
      }
      if (now - lastAt < REFRACTORY_MS) return { ...judged, magnitude: 0, size: "none", silenced: "refractory" };
      lastAt = now;
      // Used to it a step more, unless harm follows (see `harmed`).
      habituation.damp(keys, now);
      fired = [...fired.filter((f) => now - f.at <= HARM_FOLLOWS_MS), { keys, at: now }];
      return { ...judged, size };
    },

    harmed(now, by) {
      const own = by ? keysOf(by)[0] : null;
      // The same event hurting again is that event repeating, not something bad following it.
      for (const f of fired) if (now - f.at <= HARM_FOLLOWS_MS && now > f.at && f.keys[0] !== own) habituation.restore(f.keys);
      fired = fired.filter((f) => now - f.at <= HARM_FOLLOWS_MS && f.keys[0] === own);
    },
  };
}
