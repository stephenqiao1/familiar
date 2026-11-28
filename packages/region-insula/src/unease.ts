// Unease: the body doing something nothing explains. For each raw reading (each 0 to 1) the
// insula keeps what it has been doing lately (its drift), and looks at how far it has moved
// over the last half minute. A move well beyond the drift, with no known cause in that time,
// is felt as unease and names the reading.

/** How far back a change is looked for. */
export const WINDOW_MS = 30_000;
/** A reading may move this far beyond its drift in the window before it is odd (one point of health or food is 0.05). */
export const MARGIN = 0.08;
/** A move this far beyond the margin is full unease. */
export const SPAN = 0.2;
/** A cause still explains a change that shows up this long after the cause was last there (the last point lost to an effect arrives as the effect ends). */
export const CAUSE_LINGERS_MS = 2000;
/** How slowly the drift follows what the reading does: about five minutes. */
export const DRIFT_MS = 300_000;

interface Track {
  /** Samples in the window, oldest first. */
  samples: { at: number; value: number }[];
  /** What it has been doing lately, per ms. */
  drift: number;
  /** Until when a fall, and a rise, in it has a known cause. */
  explained: { down: number; up: number };
}

export interface Unease {
  /**
   * One tick. `body`: each raw reading now. `explains`: the known cause there is right now for a
   * reading falling (change below 0) or rising, or null; it is asked both ways every tick, since
   * a cause can end a moment before its last effect shows. Returns how uneasy (0 to 1) and which
   * readings it is about.
   */
  tick(body: Readonly<Record<string, number>>, explains: (reading: string, change: number) => string | null, at: number): { level: number; about: string[] };
}

export function createUnease(): Unease {
  const tracks = new Map<string, Track>();
  return {
    tick(body, explains, at) {
      let level = 0;
      const about: string[] = [];
      for (const [name, value] of Object.entries(body)) {
        if (!Number.isFinite(value)) continue;
        const track = tracks.get(name) ?? { samples: [], drift: 0, explained: { down: -Infinity, up: -Infinity } };
        if (explains(name, -1) !== null) track.explained.down = at + CAUSE_LINGERS_MS;
        if (explains(name, 1) !== null) track.explained.up = at + CAUSE_LINGERS_MS;
        tracks.set(name, track);
        const before = track.samples.at(-1);
        if (before && at > before.at) {
          const change = value - before.value;
          // A change with a known cause is taken as it is: the window starts again from here.
          if (change !== 0 && (change < 0 ? track.explained.down : track.explained.up) >= at) track.samples = [];
          const share = 1 - Math.exp(-(at - before.at) / DRIFT_MS);
          track.drift += (change / (at - before.at) - track.drift) * share;
        }
        track.samples.push({ at, value });
        while (track.samples.length > 1 && at - track.samples[0]!.at > WINDOW_MS) track.samples.shift();
        const first = track.samples[0]!;
        const odd = Math.abs(value - first.value - track.drift * (at - first.at)) - MARGIN;
        if (odd > 0) {
          level = Math.max(level, Math.min(1, odd / SPAN));
          about.push(name);
        }
      }
      return { level, about };
    },
  };
}
