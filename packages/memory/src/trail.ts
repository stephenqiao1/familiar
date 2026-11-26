// The order of places: the cells visited in the last ten minutes, in order, and the cells
// visited since the last rest (for replay at rest).

export interface Trail {
  /** Notes the cell the bot is in (a repeat of the last one is not added). */
  push(cell: string, now: number): void;
  /** The cells of the last ten minutes, oldest first. */
  recent(now: number): string[];
  /** The cells since the last rest, oldest first; `clear` empties it once they have been replayed. */
  sinceRest(): string[];
  clearRest(): void;
}

/** The longest stretch kept for replay at rest. */
const MOST_SINCE_REST = 600;

export function createTrail(keepMs = 600_000): Trail {
  let steps: { cell: string; at: number }[] = [];
  let day: string[] = [];
  return {
    push(cell, now) {
      if (steps.at(-1)?.cell === cell) return;
      steps = [...steps.filter((s) => now - s.at <= keepMs), { cell, at: now }];
      day.push(cell);
      if (day.length > MOST_SINCE_REST) day = day.slice(-MOST_SINCE_REST);
    },
    recent: (now) => steps.filter((s) => now - s.at <= keepMs).map((s) => s.cell),
    sinceRest: () => [...day],
    clearRest: () => void (day = []),
  };
}
