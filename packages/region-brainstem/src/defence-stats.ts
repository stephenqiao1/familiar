// What the defence circuit did over a run, worked out from its per-tick trace (for brain-report).

/** One tick of the defence trace, as far as the summary needs it. */
export interface DefenceRow {
  at: number;
  mode: string;
  /** The most pressing threat. */
  target: string | null;
  kind?: string | null;
  dist?: number | null;
  flightDistance?: number | null;
  /** That threat has noticed the body. */
  noticed?: boolean;
  cornered?: boolean;
  recovering?: boolean;
  /** Every threat in sight this tick. */
  present?: string[];
  /** The body died since the last tick. */
  died?: boolean;
  learned?: string[];
}

export interface DefenceSummary {
  /** Seconds spent in each mode. */
  secondsIn: Record<string, number>;
  /** Freezes that ended with the threat never having noticed, and those it saw through. */
  freezes: { worked: number; failed: number };
  /** Each flight: the kind fled, how far off it was when the flight began, and the flight distance then. */
  flights: { kind: string | null; startedAt: number | null; flightDistance: number | null }[];
  /** Fights that ended with the threat gone, and those that ended in death or a retreat. */
  fights: { won: number; lost: number };
  cornered: number;
  recoveries: number;
  learned: string[];
  /** Each death, with the modes of the 5 seconds before it. */
  deaths: { at: number; before: { msAgo: number; mode: string; kind: string | null; dist: number | null }[] }[];
}

const BEFORE_DEATH_MS = 5000;
/** A gap longer than this between ticks is not counted as time in a mode. */
const MAX_TICK_MS = 2000;

/** Summarises a run's defence rows (in time order). */
export function summariseDefence(rows: readonly DefenceRow[]): DefenceSummary {
  const out: DefenceSummary = { secondsIn: {}, freezes: { worked: 0, failed: 0 }, flights: [], fights: { won: 0, lost: 0 }, cornered: 0, recoveries: 0, learned: [], deaths: [] };
  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    const next = rows[i + 1];
    const dt = next ? Math.min(MAX_TICK_MS, Math.max(0, next.at - row.at)) : 0;
    out.secondsIn[row.mode] = (out.secondsIn[row.mode] ?? 0) + dt / 1000;
    const began = (mode: string) => row.mode === mode && (prev?.mode !== mode || prev.target !== row.target);
    const ended = (mode: string) => prev?.mode === mode && (row.mode !== mode || row.target !== prev.target);
    if (began("flee")) out.flights.push({ kind: row.kind ?? null, startedAt: row.dist ?? null, flightDistance: row.flightDistance ?? null });
    if (prev && ended("freeze")) {
      // Seen through: the same threat is now coming for the body, or has noticed it.
      const sawThrough = row.target === prev.target && (row.noticed === true || row.mode === "flee" || row.mode === "fight");
      out.freezes[sawThrough || row.died ? "failed" : "worked"]++;
    }
    if (prev && ended("fight")) {
      const gone = prev.target !== null && !(row.present ?? []).includes(prev.target);
      out.fights[gone && !row.died ? "won" : "lost"]++;
    }
    if (row.cornered && !prev?.cornered) out.cornered++;
    if (row.recovering && !prev?.recovering) out.recoveries++;
    for (const note of row.learned ?? []) out.learned.push(note);
    if (row.died) {
      const before = rows.slice(0, i).filter((r) => row.at - r.at <= BEFORE_DEATH_MS);
      out.deaths.push({ at: row.at, before: before.map((r) => ({ msAgo: row.at - r.at, mode: r.mode, kind: r.kind ?? null, dist: r.dist ?? null })) });
    }
  });
  for (const mode of Object.keys(out.secondsIn)) out.secondsIn[mode] = Math.round(out.secondsIn[mode]! * 10) / 10;
  return out;
}
