// The defence circuit's choice (the periaqueductal gray): not what the threat is, only which kind
// of defence fits how close the danger is in time, whether it has noticed the body, and whether
// there is a way out. Pure and game-free: plain numbers in, one mode out.
// Change which defence goes with which situation here. Every number is a first guess.

/** How close the danger is in time. */
export type Stage = "possible" | "seen" | "coming" | "on_it";
/**
 * The kind of defence. `wary` and `avoid` propose nothing (watchfulness, and routing round);
 * `freeze` holds still; `flee` and `fight` are the active ones.
 */
export type Mode = "none" | "wary" | "avoid" | "freeze" | "flee" | "fight";

/** One thing that might be a threat, sized up. */
export interface Threat {
  id: string;
  kind: string;
  /** Blocks away. */
  dist: number;
  stage: Stage;
  /** It has noticed the body. */
  noticed: boolean;
  /** It can get to the body (or hit it from where it is). */
  canReach: boolean;
  /** The body has a way out. */
  escapable: boolean;
  /** How dangerous this kind has been, 0 to 1. */
  danger: number;
  /** This kind has been beaten more often than lost to. */
  beatable: boolean;
  /** How far off this threat starts to count as coming, in blocks. */
  flightDistance: number;
  /** Whether it can reach the body is still a guess, being worked out right now. Default: false. */
  settling?: boolean;
}

export interface DefenceInputs {
  threats: Threat[];
  /** Why danger is possible with nothing seen (dark, a bad memory, a sound), or null. */
  possible: string | null;
  /** Health as a share of full. */
  health: number;
  armed: boolean;
  /** The body is on a journey of its own (so a seen threat is routed round, not frozen for). */
  travelling: boolean;
}

/** The defence chosen, with why. */
export interface Choice {
  mode: Mode;
  /** The urgency the mode's reflex starts from (0 for a mode that proposes nothing). */
  base: number;
  why: string;
  /** The most pressing threat's id, or null. */
  target: string | null;
  /** How pressing: 0 none, 0.3 possible, 0.5 seen, 0.8 coming, 1 on it. */
  threat: number;
  flightDistance: number | null;
  cornered: boolean;
  /** How many threats are coming or on the body. */
  coming: number;
}

/** How far each strength (0 to 1) reaches. */
export interface DefenceStrengths {
  /** Freezing for a threat that has not noticed: scales its urgency (0 never freezes). */
  freeze: number;
  /** Being cornered changes the defence. On above 0. */
  cornered: number;
}

/** A threat whose reach is still a guess is only watched while it is beyond this share of its flight distance. */
export const HOLD_BEYOND = 0.5;
export const BASE = { freeze: 0.5, corneredFreeze: 0.6, flee: 0.7, breakAway: 0.9, fight: 0.9 };
export const THREAT_LEVEL: Record<Stage, number> = { possible: 0.3, seen: 0.5, coming: 0.8, on_it: 1 };
/** Flight distance for a middling threat and a middling bot, in blocks. */
export const FLIGHT_BLOCKS = 8;
/** A threat that has not noticed is frozen for within this many flight distances; further off it is only watched. */
export const FREEZE_WITHIN = 1.5;
/** Below this share of health the body is too weak to choose a fight. */
export const WEAK_HEALTH = 0.5;
/** This many threats coming at once and the body counts itself weak. */
export const OUTNUMBERED = 3;
const RANK: Record<Stage, number> = { possible: 0, seen: 1, coming: 2, on_it: 3 };

/**
 * How far off a threat starts to count as coming: 8 × (0.5 + danger) × (1.3 − 0.6 × bravery).
 * A kind that has hurt badly sets the body off from further away; a brave body lets things
 * closer. `strength` 0 leaves it at a flat 8.
 */
export function flightDistance(danger: number, bravery: number, strength = 1): number {
  return FLIGHT_BLOCKS * (1 + strength * ((0.5 + danger) * (1.3 - 0.6 * bravery) - 1));
}

/** The most pressing threat: the furthest along in time, then the closest. */
export function mostPressing(threats: readonly Threat[]): Threat | null {
  return [...threats].sort((a, b) => RANK[b.stage] - RANK[a.stage] || a.dist - b.dist)[0] ?? null;
}

/**
 * Chooses one defence for the most pressing threat:
 *   possible                               → wary (no action)
 *   seen, cannot reach the bot             → wary (no action)
 *   seen, not noticed                      → freeze (0.5), or avoid while travelling
 *   coming, a way out                      → flee (0.7)
 *   coming, reach still a guess, not close → freeze (0.5) until the route check answers
 *   coming, cornered                       → freeze (0.6)
 *   on it, a way out, and unarmed, weak or not beatable → flee (0.9: break away)
 *   on it, cornered, or armed, healthy and beatable     → fight (0.9)
 * Three or more coming at once count the body as weak. Asked afresh every tick, so a freeze ends
 * the tick its threat notices and closes.
 */
export function chooseDefence(inputs: DefenceInputs, strengths: DefenceStrengths = { freeze: 1, cornered: 1 }): Choice {
  const top = mostPressing(inputs.threats);
  const coming = inputs.threats.filter((t) => RANK[t.stage] >= RANK.coming).length;
  if (!top) {
    const wary = inputs.possible !== null;
    return { mode: wary ? "wary" : "none", base: 0, why: wary ? `danger is possible: ${inputs.possible}` : "nothing threatening", target: null, threat: wary ? THREAT_LEVEL.possible : 0, flightDistance: null, cornered: false, coming };
  }
  const cornered = strengths.cornered > 0 && !top.escapable;
  const about = `${top.kind} ${round(top.dist)} blocks away`;
  const choice = (mode: Mode, base: number, why: string): Choice => ({ mode, base, why: `${about}, ${why}`, target: top.id, threat: THREAT_LEVEL[top.stage], flightDistance: round(top.flightDistance), cornered, coming });

  if (top.stage === "possible") return choice("wary", 0, inputs.possible ?? "not seen");
  if (top.stage === "seen") {
    // One that cannot get to the bot is watched, noticed or not: there is nothing to hide from.
    if (!top.canReach) return choice("wary", 0, top.noticed ? "has noticed but cannot reach" : "cannot reach");
    if (top.noticed) return choice("wary", 0, "has noticed but is beyond the flight distance");
    if (top.dist > FREEZE_WITHIN * top.flightDistance) return choice("wary", 0, "has not noticed, far off");
    if (inputs.travelling) return choice("avoid", 0, "has not noticed: routing round it");
    if (strengths.freeze <= 0) return choice("wary", 0, "has not noticed (freezing is off)");
    return choice("freeze", BASE.freeze * strengths.freeze, "has not noticed: holding still");
  }
  if (top.stage === "coming") {
    // Reach still a guess, and it is not close yet: hold still and watch until the answer comes (a second or two).
    if (top.settling && top.dist > HOLD_BEYOND * top.flightDistance) return choice("freeze", BASE.freeze, "coming, if it can get here: holding still to find out");
    return cornered ? choice("freeze", BASE.corneredFreeze, "coming, and no way out yet") : choice("flee", BASE.flee, `coming (inside ${round(top.flightDistance)} blocks)`);
  }
  // On it.
  const outnumbered = coming >= OUTNUMBERED;
  const weak = inputs.health < WEAK_HEALTH || outnumbered;
  if (cornered) return choice("fight", BASE.fight, "on it and cornered: fighting");
  if (inputs.armed && !weak && top.beatable) return choice("fight", BASE.fight, "on it; armed, healthy and it can be beaten");
  const lack = !inputs.armed ? "no weapon" : outnumbered ? `${coming} coming at once` : weak ? "weak" : "not one it has beaten";
  return choice("flee", BASE.breakAway, `on it, ${lack}: breaking away`);
}

/** The reflex that carries each mode, or null for a mode that proposes nothing. */
export const DEFENCE_RULES = { freeze: "defence_freeze", flee: "defence_flee", fight: "defence_fight" } as const;

const round = (n: number) => Math.round(n * 10) / 10;
