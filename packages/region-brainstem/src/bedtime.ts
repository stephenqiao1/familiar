import type { Proposal, Workspace } from "@familiar/contracts";

// Going to bed: a soft proposal when sleepy, with a flip-flop so the bot does not dither at the
// bedroom door, and a pause after the world refuses.

/** The skill that is going to bed, and why it cannot be started right now (null: it can). */
export interface Bed {
  skill: string;
  problem(ws: Workspace): string | null;
}

/** Heading to bed starts above this sleepiness and is given up below this one. */
export const BEDTIME = { above: 0.5, giveUpBelow: 0.3 };
/** The proposal's urgency: 0.2 at the threshold, rising to 0.6 fully sleepy. */
export const URGENCY = { from: 0.2, to: 0.6 };
/** After sleep is refused, bed is not proposed again for this long. */
export const REFUSED_MS = 30_000;
/** A wake drive above this ends a trip to bed. */
const GIVE_UP_WAKE = 0.5;

export interface BedtimeInput {
  sleepy: number;
  wake: number;
  /** Why bed must not be proposed right now (a threat in view, a risky skill, something pressing), or null. */
  pressing: string | null;
  inBed: boolean;
  bed: Bed | null;
  ws: Workspace;
  now: number;
}

export interface Bedtime {
  step(input: BedtimeInput): { proposal?: Proposal; note?: Record<string, unknown> };
}

export function createBedtime(): Bedtime {
  let heading = false;
  let refusedUntil = -Infinity;
  let seenRefusal = -Infinity;
  return {
    step({ sleepy, wake, pressing, inBed, bed, ws, now }) {
      // The world said no (dawn, monsters near, no way to the bed): leave it a while.
      if (bed) {
        for (const event of ws.recentEvents) {
          if (event.skill !== bed.skill || event.type !== "failed" || event.timestamp <= seenRefusal) continue;
          seenRefusal = event.timestamp;
          refusedUntil = event.timestamp + REFUSED_MS;
        }
      }
      if (inBed) {
        heading = false;
        return {};
      }
      // The flip-flop: on above 0.5, off only below 0.3 or when something wakes the bot up properly.
      if (heading && (sleepy < BEDTIME.giveUpBelow || wake > GIVE_UP_WAKE)) heading = false;
      else if (!heading && sleepy > BEDTIME.above && pressing === null) heading = true;
      if (!heading) return {};
      const waiting = pressing ?? (!bed ? "no way to sleep is known" : now < refusedUntil ? `sleep was refused: waiting ${Math.ceil((refusedUntil - now) / 1000)} s` : bed.problem(ws));
      if (waiting || !bed) return { note: { sleepy: Math.round(sleepy * 100) / 100, delayed: waiting } };
      const urgency = URGENCY.from + (URGENCY.to - URGENCY.from) * Math.min(1, Math.max(0, (sleepy - BEDTIME.above) / (1 - BEDTIME.above)));
      return { proposal: { action: { skill: bed.skill }, urgency, reason: `sleepy (${sleepy.toFixed(2)}): going to bed` }, note: { sleepy: Math.round(sleepy * 100) / 100, proposed: Math.round(urgency * 100) / 100 } };
    },
  };
}
