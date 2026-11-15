/** A soft defence reflex that fired but did not get its way on some tick. */
export interface OverruledDefence {
  at: number;
  rule: string;
  skill: string | null;
  gain: number;
  urgency: number;
  /** The goal was holding this reflex back. */
  heldBack: boolean;
  /** What won instead. */
  winner: { region: string; skill: string | null; urgency: number; reason: string } | null;
}

/** What the watch is told each tick. */
export interface DefenceTick {
  now: number;
  /** The soft defence reflexes that fired this tick. */
  fired: { rule: string; skill: string | null; gain: number; urgency: number; heldBack: boolean; /** Its proposal was the one acted on. */ won: boolean }[];
  winner: { region: string; skill: string | null; urgency: number; reason: string } | null;
  /** A threat is close right now. */
  threatClose: boolean;
  /** The bot died since the last tick. */
  died: boolean;
}

/** A death counts against tunable defence if a defence reflex was overruled this recently with a threat close. */
const RECENT_MS = 10_000;

/**
 * The cost of making defence tunable, made visible: remembers when a soft defence reflex was held
 * back or outvoted while a threat was close, and if the bot dies soon after, returns that record
 * so it can be logged loudly.
 */
export function createDefenceWatch(): { observe(tick: DefenceTick): OverruledDefence | null } {
  let last: OverruledDefence | null = null;
  return {
    observe({ now, fired, winner, threatClose, died }) {
      if (threatClose) {
        const lost = fired.find((f) => f.heldBack || !f.won);
        if (lost) last = { at: now, rule: lost.rule, skill: lost.skill, gain: lost.gain, urgency: lost.urgency, heldBack: lost.heldBack, winner };
      }
      if (!died) return null;
      const blamed = last && now - last.at <= RECENT_MS ? last : null;
      last = null;
      return blamed;
    },
  };
}
