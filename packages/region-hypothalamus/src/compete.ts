import type { NeedReading, TopDrive } from "@familiar/contracts";

// How the needs compete: which one the body wants most (and sticks with), and when one is
// desperate. Pure and game-free.

export const COMPETE = {
  /** A new need takes the top place only by beating the old one by this much... */
  beatBy: 0.1,
  /** ...or once the old one has fallen under this. */
  letGoBelow: 0.2,
  /** A need of the body above this is desperate. */
  desperateAbove: 0.8,
  /** Fully desperate, the brake on costly actions is this much weaker, */
  brakeOff: 0.5,
  /** and a threat is let this much closer before the body runs. */
  flightOff: 0.25,
};

/** How much a need counts when the needs are compared: how hard it presses, by its weight (never more than in full). */
export const scoreOf = (n: Pick<NeedReading, "pressing" | "weight">) => n.pressing * Math.min(1, n.weight);

/** How desperate the body is, 0 to 1, and for what: its worst need that is not about safety, above 0.8. */
export function desperateOf(readings: readonly NeedReading[]): { value: number; name: string | null } {
  const worst = readings.filter((n) => n.kind !== "safety").map((n) => ({ name: n.name, at: n.level * Math.min(1, n.weight) })).sort((a, b) => b.at - a.at)[0];
  const value = worst ? Math.min(1, Math.max(0, (worst.at - COMPETE.desperateAbove) / (1 - COMPETE.desperateAbove))) : 0;
  return { value, name: value > 0 ? worst!.name : null };
}

/** Keeps track of the need the body wants most. It is sticky: the body does not flit between two needs that press about the same. */
export function createTopDrive(): { step(readings: readonly NeedReading[], now: number): TopDrive | null; reset(): void } {
  let top: { name: string; since: number } | null = null;
  return {
    step(readings, now) {
      const best = [...readings].sort((a, b) => scoreOf(b) - scoreOf(a))[0];
      const held = top && readings.find((n) => n.name === top!.name);
      const keep = held && scoreOf(held) >= COMPETE.letGoBelow && !(best && scoreOf(best) > scoreOf(held) + COMPETE.beatBy);
      const leader = keep ? held : best && scoreOf(best) > 0 ? best : null;
      if (!leader) {
        top = null;
        return null;
      }
      if (!top || top.name !== leader.name) top = { name: leader.name, since: now };
      return { name: leader.name, kind: leader.kind, score: scoreOf(leader), since: top.since };
    },
    reset() {
      top = null;
    },
  };
}
