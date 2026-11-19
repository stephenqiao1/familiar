// The graded gate, as its readers use it: a layer that is normally called every `intervalMs`
// is called no more often than intervalMs ÷ rate. One gate per layer.

export interface RateGate {
  /**
   * Whether to skip a call right now. `rate` is 0 to 1 (0: never call; 1: no limit); `urgent`
   * lets the call through whatever the rate. Asking again for the same moment gives the same answer.
   */
  hold(rate: number, now: number, urgent?: boolean): boolean;
  /** Calls let through and calls held so far. */
  counts(): { made: number; saved: number };
}

export function createRateGate(intervalMs: number): RateGate {
  let last = -Infinity;
  let asked: { now: number; held: boolean } | null = null;
  const counts = { made: 0, saved: 0 };
  return {
    hold(rate, now, urgent = false) {
      if (asked?.now === now) return asked.held;
      const held = !urgent && rate < 1 && (rate <= 0 || now - last < intervalMs / rate);
      if (held) counts.saved++;
      else {
        counts.made++;
        last = now;
      }
      asked = { now, held };
      return held;
    },
    counts: () => ({ ...counts }),
  };
}
