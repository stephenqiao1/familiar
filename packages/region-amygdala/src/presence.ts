import type { CueNow } from "./learn.js";

// Which cues are around, and for how long. A cue stays "around" for a few seconds after it was
// last offered (a food, for a minute), so that what came just before an outcome is blamed. A
// cue that was around and then gone, with no harm in between, was a harmless meeting.

/** A cue as the game's side offers it. */
export interface Cue extends CueNow {
  /** How long after it was last offered it still counts, in ms. Default: 5 seconds. */
  lingerMs?: number;
  /** Seen from where it could not do its harm (a hurtful block a few steps off): no harm then says nothing about it. Default: false. */
  apart?: boolean;
  /** What the bot is born believing of it, if anything. */
  born?: { harm?: number; good?: number };
}

export interface Meeting {
  key: string;
  /** How long the cue was around, in ms. */
  ms: number;
  /** How much it stood out. */
  salience: number;
}

export const PRESENCE = {
  lingerMs: 5000,
  /** A cue that stays around is judged harmless once every this long. */
  meetingMs: 60_000,
};

export interface Presence {
  /** Notes the cues offered this tick. */
  note(cues: readonly Cue[], now: number): void;
  /** The cues around now; one no longer offered counts less the longer ago it was. */
  around(now: number): CueNow[];
  /** The meetings that have just ended with no harm (call once a tick). */
  harmless(now: number): Meeting[];
  /** Harm came: no meeting under way was harmless. */
  harmed(now: number): void;
}

export function createPresence(): Presence {
  /** `apart`: it has only been seen from a distance for the whole of this meeting. */
  const held = new Map<string, { cue: Cue; since: number; last: number; apart: boolean }>();
  const linger = (c: Cue) => c.lingerMs ?? PRESENCE.lingerMs;
  return {
    note(cues, now) {
      for (const cue of cues) {
        const was = held.get(cue.key);
        // One channel holds one thing at a time (the gut: the last thing eaten). A new one ends the stay of the one before.
        if (cue.through && !was) for (const h of held.values()) if (h.cue.through === cue.through) h.last = -Infinity;
        const going = was !== undefined && now - was.last <= linger(was.cue);
        held.set(cue.key, { cue, since: going ? was.since : now, last: now, apart: (going ? was.apart : true) && cue.apart === true });
      }
    },
    around(now) {
      return [...held.values()]
        .filter((h) => now - h.last <= linger(h.cue))
        .map((h) => ({ key: h.cue.key, salience: h.cue.salience * (1 - (now - h.last) / (linger(h.cue) * 2)), ...(h.cue.through ? { through: h.cue.through } : {}), ...(h.cue.direct ? { direct: true } : {}) }));
    },
    harmless(now) {
      const ended: Meeting[] = [];
      for (const [key, h] of held) {
        if (now - h.last > linger(h.cue)) {
          if (!h.apart) ended.push({ key, ms: now - h.since, salience: h.cue.salience });
          held.delete(key);
        } else if (now - h.since >= PRESENCE.meetingMs) {
          if (!h.apart) ended.push({ key, ms: now - h.since, salience: h.cue.salience });
          h.since = now;
          h.apart = h.cue.apart === true;
        }
      }
      return ended;
    },
    harmed(now) {
      for (const h of held.values()) h.since = now;
    },
  };
}
