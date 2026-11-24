// The burst: a turned-down channel stays quiet, but when something new appears or changes in
// it, that one item is passed once, in brief, marked as new: a wake-up call. If it then earns
// its place by priority it stays; otherwise it goes back to being counted.

/** News is announced again only after its source has been quiet this long: a mob that groans every few seconds is one piece of news, not one a groan. */
export const QUIET_MS = 60_000;

/** A piece of news: the item, and what it is news of (the item itself, or its kind at its rough place). */
export interface News {
  id: string;
  source: string;
}

/** Remembers what has already been announced, so that a thing bursts once for each time it is news. One per reader. */
export interface Bursts {
  /** Of the items that are news in a turned-down channel this tick, those whose source has not been announced. Marks them announced. */
  due(news: readonly News[], now: number): string[];
}

export function createBursts(): Bursts {
  /** When each source was last news. */
  const last = new Map<string, number>();
  return {
    due(news, now) {
      // A source quiet for long enough may burst again the next time it is news.
      for (const [source, at] of last) if (now - at > QUIET_MS) last.delete(source);
      const due: string[] = [];
      for (const { id, source } of news) {
        if (!last.has(source)) due.push(id);
        last.set(source, now);
      }
      return due;
    },
  };
}
