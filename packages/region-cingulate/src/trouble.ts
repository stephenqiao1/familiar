import type { TroubleEvent } from "@familiar/contracts";

// One reading of trouble. Every source of trouble gives a strength (0 to 1) and what it
// concerns. One event must count once: sources that rise within a second of each other and
// concern the same thing (or say nothing of what they concern) are one event with several faces.

/** A source counts as up from this strength. */
export const UP_AT = 0.1;
/** A face is gone once its source is under this. */
export const GONE_UNDER = 0.05;
/** Sources that rise within this long of each other may be one event. */
export const SAME_EVENT_MS = 1000;

/** One source's reading this tick. */
export interface Sign {
  /** The kind of trouble ("conflict", "mismatch", "pain"). */
  name: string;
  /** 0 to 1. */
  strength: number;
  /** What it concerns: the thing, the movement, the skill. Empty: it does not say. */
  about?: readonly string[];
}

interface Event {
  /** Each face and how strong its source is now. */
  faces: Map<string, number>;
  about: Set<string>;
  /** When its first sign rose, and its latest. */
  at: number;
  latest: number;
}

export interface Gathered {
  level: number;
  events: TroubleEvent[];
}

export interface TroubleKeeper {
  /** One tick of readings. Returns the level (every event's strength, combined so that two events are more than one) and the events behind it, strongest first. */
  tick(signs: readonly Sign[], now: number): Gathered;
}

export function createTrouble(): TroubleKeeper {
  let events: Event[] = [];
  /** Which sources were up last tick. */
  const up = new Set<string>();
  const concern = (event: Event, about: readonly string[]) => about.length === 0 || event.about.size === 0 || about.some((a) => event.about.has(a));
  return {
    tick(signs, now) {
      for (const { name, strength, about = [] } of signs) {
        const held = events.find((e) => e.faces.has(name));
        if (strength < UP_AT) {
          up.delete(name);
          // A face fades with its source, and goes when the source is all but gone.
          if (held) strength < GONE_UNDER ? held.faces.delete(name) : held.faces.set(name, strength);
          continue;
        }
        if (held) held.faces.set(name, strength);
        if (up.has(name)) continue;
        up.add(name);
        if (held) continue;
        // A source just rose: it joins an event whose latest sign is under a second old and that concerns the same thing, or begins one.
        const same = events.find((e) => now - e.latest <= SAME_EVENT_MS && concern(e, about));
        const event = same ?? { faces: new Map<string, number>(), about: new Set<string>(), at: now, latest: now };
        event.faces.set(name, strength);
        for (const a of about) event.about.add(a);
        event.latest = now;
        if (!same) events.push(event);
      }
      events = events.filter((e) => e.faces.size > 0);
      const out = events.map((e) => ({ kinds: [...e.faces.keys()], about: [...e.about], strength: Math.max(...e.faces.values()), age: now - e.at })).sort((a, b) => b.strength - a.strength);
      // One event is as much trouble as it is strong; several add up without ever passing 1.
      const level = out.length <= 1 ? Math.min(1, out[0]?.strength ?? 0) : 1 - out.reduce((left, e) => left * (1 - Math.min(1, e.strength)), 1);
      return { level, events: out };
    },
  };
}
