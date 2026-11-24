// The planner talks back: a goal may list kinds or ids it wants to be told about in full
// (`detail`). At most five count, and one that matches nothing for a minute is dropped.

export const ASKS = { most: 5, dropAfterMs: 60_000 };

export interface Asks {
  /** The asks in force: the goal's first five, less those that have matched nothing for a minute. `matched` are the asks something in the state answers to right now. */
  active(asked: readonly string[], matched: ReadonlySet<string>, now: number): string[];
}

export function createAsks(): Asks {
  /** When each ask last matched something (or was first made). */
  const lastMatch = new Map<string, number>();
  return {
    active(asked, matched, now) {
      const first = [...new Set(asked)].slice(0, ASKS.most);
      for (const ask of [...lastMatch.keys()]) if (!first.includes(ask)) lastMatch.delete(ask);
      for (const ask of first) if (matched.has(ask) || !lastMatch.has(ask)) lastMatch.set(ask, now);
      return first.filter((ask) => now - lastMatch.get(ask)! <= ASKS.dropAfterMs);
    },
  };
}
