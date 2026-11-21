import { flightDistance, type Stage, type Threat } from "@familiar/region-brainstem";

// Sizing up one thing that might be a threat: has it noticed the bot, can it get to it, and how
// close the danger is in time. Plain facts in, one assessment out; no game objects here.
// Change what counts as "noticed" or where each stage begins here.

/** A threat this close that can reach the bot is on it. */
export const CONTACT_DISTANCE = 3;
/** A threat the bot is fighting stays "on it" out to this distance, so a blow that knocks it back does not end the fight. */
export const ENGAGED_DISTANCE = 6;
/** A threat is noticed (seen stage) out to this distance. */
export const FAR_DISTANCE = 16;
/** Coming toward the bot at this many blocks a second or more counts as having noticed it. */
export const NOTICED_APPROACH = 0.5;
/** Having hurt the bot this recently, it has noticed it; this recently, it is on it. */
export const HURT = { noticedMs: 10_000, onItMs: 2000 };

/** What is known about one possible threat this tick. */
export interface ThreatFacts {
  id: string;
  kind: string;
  dist: number;
  /** In view. */
  seen: boolean;
  /** How fast it is itself coming toward the bot, in blocks a second (0 or less: not coming). */
  approach: number;
  /** Looming: closing fast whatever the distance. */
  looming: boolean;
  /** Facing the bot. */
  facing: boolean;
  /** How long ago it last hurt the bot, or null. */
  hurtMsAgo: number | null;
  /** The bot is fighting it: it struck it in the last few seconds, or is attacking it now. Default: false. */
  engaged?: boolean;
  /** It was judged to have noticed the bot a moment ago (noticing does not lapse the instant it stops moving). Default: false. */
  noticedLately?: boolean;
  /** A route exists from it to the bot (or the cheap guess at one). */
  canWalkTo: boolean;
  /** `canWalkTo` is still the cheap guess: the route check has been asked and has not answered yet. Default: false. */
  settling?: boolean;
  /** Nothing solid between it and the bot. */
  clearLine: boolean;
  /** This kind hits from afar. */
  shoots: boolean;
  /** The bot has a way out. */
  escapable: boolean;
  danger: number;
  beatable: boolean;
}

/** One threat as the state carries it: the assessment, with what it was made from. */
export interface ThreatView extends Threat {
  seen: boolean;
  shoots: boolean;
  /** How it was judged to have noticed, or null. */
  noticedBy: "approach" | "facing" | "hurt" | "struck" | "lately" | null;
}

/** These hurt through a wall (a blast), so being unable to get to the bot does not make them harmless. */
const HURTS_THROUGH_WALLS = new Set(["creeper"]);

/**
 * Whether a sized-up threat could harm the bot from where it is: it can get to the bot (or hit it
 * from there), it is on the bot or has just hurt it, or it would blast through a wall. A mob shut
 * in a cage, or across a gap it cannot cross, could not. This is the one test of whether a threat
 * counts: for the danger the bot feels, and for the room its journeys give a threat.
 */
export function couldHarm(threat: Pick<Threat, "canReach" | "stage" | "kind">): boolean {
  return threat.canReach || threat.stage === "on_it" || HURTS_THROUGH_WALLS.has(threat.kind);
}

/**
 * Sizes up one threat.
 *   noticed:  it is coming toward the bot, facing it, has hurt it lately, or the bot has struck it.
 *   canReach: a route exists, or it shoots and has a clear line.
 *   stage:    on it (within 3 blocks and able to reach, within 6 while the bot is fighting it,
 *             or it has just hurt the bot),
 *             coming (looming, or noticed and able to reach inside the flight distance),
 *             seen (in view), else possible.
 */
export function sizeUp(facts: ThreatFacts, bravery: number, flightStrength = 1): ThreatView {
  const { id, kind, dist, seen, shoots, escapable, danger, beatable } = facts;
  const hurtLately = facts.hurtMsAgo !== null && facts.hurtMsAgo <= HURT.noticedMs;
  const noticedBy = hurtLately ? "hurt" : facts.engaged ? "struck" : facts.approach >= NOTICED_APPROACH ? "approach" : facts.facing && seen ? "facing" : facts.noticedLately ? "lately" : null;
  const noticed = noticedBy !== null;
  const canReach = facts.canWalkTo || (shoots && facts.clearLine);
  const flight = flightDistance(danger, bravery, flightStrength);
  const justHurt = facts.hurtMsAgo !== null && facts.hurtMsAgo <= HURT.onItMs;
  const stage: Stage =
    (dist <= CONTACT_DISTANCE && canReach) || (justHurt && dist <= CONTACT_DISTANCE + 1) || (facts.engaged === true && canReach && dist <= ENGAGED_DISTANCE)
      ? "on_it"
      : facts.looming || justHurt || (noticed && canReach && dist <= flight)
        ? "coming"
        : seen && dist <= Math.max(FAR_DISTANCE, flight)
          ? "seen"
          : "possible";
  // Coming only on a guess at its reach (not looming, and it has not hurt the bot lately, which would settle it): to be watched, not yet run from.
  const settling = facts.settling === true && stage === "coming" && !facts.looming && !hurtLately;
  return { id, kind, dist, stage, noticed, canReach, escapable, danger: round(danger), beatable, flightDistance: round(flight), seen, shoots, noticedBy, ...(settling ? { settling } : {}) };
}

const round = (n: number) => Math.round(n * 100) / 100;
