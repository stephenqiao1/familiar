// How changeable things are. The cingulate counts each surprise as it arrives (an outcome that
// was not expected, a movement that went wrong, something out of place) and compares how often
// they have come lately with how often they usually do. High when recent surprises run well above usual.

/** "Lately" is about this long; "usually" about this long. */
export const RECENT_MS = 120_000;
export const USUAL_MS = 1_800_000;
/** A source counts again once it has risen by this much. */
export const RISE = 0.1;
/** Recent surprises must run this many times the usual, and this many a minute beyond it, before anything is called changeable. */
export const ABOVE = { times: 1.5, more: 0.2 };

export interface ChangeableKeeper {
  /** One tick: each source of surprise and its level now (0 to 1). A source is counted when it rises. Returns `changeable` and the two rates behind it, a minute. */
  tick(sources: Readonly<Record<string, number>>, now: number): { changeable: number; recent: number; usual: number };
}

export function createChangeable(): ChangeableKeeper {
  const before = new Map<string, number>();
  let [recent, usual] = [0, 0];
  let last: number | null = null;
  let began: number | null = null;
  /** A count kept over a window, as a rate a minute: over the window, or over the life so far while that is shorter (so a young bot's first surprise is not "more than usual"). */
  const rate = (kept: number, windowMs: number, now: number) => kept / (Math.max(1000, Math.min(windowMs, now - began!)) / 60_000);
  return {
    tick(sources, now) {
      let felt = 0;
      for (const [name, level] of Object.entries(sources)) {
        const was = before.get(name) ?? 0;
        if (level - was >= RISE) felt += level - was;
        before.set(name, level);
      }
      const dt = last === null ? 0 : Math.max(0, now - last);
      last = now;
      began ??= now;
      recent = recent * Math.exp(-dt / RECENT_MS) + felt;
      usual = usual * Math.exp(-dt / USUAL_MS) + felt;
      const [lately, usually] = [rate(recent, RECENT_MS, now), rate(usual, USUAL_MS, now)];
      const over = lately - ABOVE.times * usually - ABOVE.more;
      return { changeable: Math.min(1, Math.max(0, over / (2 * usually + 1))), recent: lately, usual: usually };
    },
  };
}
