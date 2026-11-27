import type { MovementFacts } from "../movements.js";
import { SPEED } from "./gait.js";
import type { Stretch } from "./stretches.js";
import type { Gait } from "./types.js";

// What the journeys take from the cerebellum: the learned pace on each kind of ground. Each use
// has a strength from 0 (the fixed speeds in gait.ts, as before) to 1, and ground with no trusted
// model is priced at the fixed speed, so with nothing learned every answer is the old one.

export interface LearnedPace {
  /** Seconds per block in this pattern on this ground as learned, and its spread; null with no trusted model. */
  pace(pattern: string, facts: MovementFacts): { value: number; spread: number } | null;
  /** How far the estimate, the late rule and the stumble check each go by it, 0 to 1. */
  strengths(): { estimates: number; late: number; pace: number };
}

/** A journey is late once it has run past this many times its estimate (the fixed rule). */
export const LATE_FACTOR = 2;
/** A learned limit is the usual time and this many spreads. */
const SPREADS = 3;
/** The stumble check's allowance moves with the pace no further than this, either way. */
const ALLOWANCE = { least: 0.5, most: 1.5 };
/** One spread of a learned pace is never taken as under this share of it. */
const LEAST_SPREAD = 0.1;

const mix = (fixed: number, learned: number, strength: number) => fixed + Math.min(1, Math.max(0, strength)) * (learned - fixed);
/** The fixed pace, in seconds per block. */
export const fixedPace = (pattern: string, gait: Gait) => 1 / (pattern === "swim" ? SPEED.swim : SPEED[gait]);

/** How long `blocks` should take from here: the fixed estimate moved toward the learned pace on this ground. */
export function estimateSeconds(blocks: number, facts: MovementFacts, gait: Gait, learned: LearnedPace | undefined): { seconds: number; fixed: number } {
  const fixed = blocks * fixedPace(facts.pattern ?? "walk", gait);
  const p = learned?.pace(facts.pattern ?? "walk", facts);
  return { fixed, seconds: p ? mix(fixed, blocks * p.value, learned!.strengths().estimates) : fixed };
}

export interface Expected {
  /** How long the ground covered should have taken, and the usual error of that. */
  seconds: number;
  spread: number;
  /** Every stretch was priced by a trusted model. */
  trusted: boolean;
}

/**
 * How long the ground a journey has covered should have taken: each stretch at the learned pace
 * for its ground, and whatever was not measured (`rest` blocks) at the pace of the ground it
 * started on. Ground with no trusted model is priced at the fixed speed, with a spread that puts
 * three spreads at twice the time: the fixed late rule.
 */
export function expectedOver(stretches: readonly Stretch[], rest: { blocks: number; facts: MovementFacts }, gait: Gait, learned: LearnedPace | undefined): Expected {
  let [seconds, spread, trusted] = [0, 0, true];
  for (const s of [...stretches, rest]) {
    if (s.blocks <= 0) continue;
    const p = learned?.pace(s.facts.pattern ?? "walk", s.facts);
    const fixed = fixedPace(s.facts.pattern ?? "walk", gait);
    trusted &&= Boolean(p);
    seconds += s.blocks * (p ? p.value : fixed);
    spread += s.blocks * (p ? Math.max(p.spread, LEAST_SPREAD * p.value) : ((LATE_FACTOR - 1) * fixed) / SPREADS);
  }
  return { seconds, spread, trusted };
}

/** The longest the journey may take before it is late, in seconds: the fixed rule moved toward the learned one. */
export function lateAfter(estimateSeconds: number, expected: Expected, floor: number, learned: LearnedPace | undefined): number {
  const fixed = LATE_FACTOR * estimateSeconds;
  return learned ? mix(fixed, Math.max(floor, expected.seconds + SPREADS * expected.spread), learned.strengths().late) : fixed;
}

/** How far the stumble check's allowance is scaled here: slow ground asks for less ground covered, fast ground for more. */
export function stumbleScale(facts: MovementFacts, gait: Gait, learned: LearnedPace | undefined): number {
  const p = learned?.pace(facts.pattern ?? "walk", facts);
  if (!p) return 1;
  return mix(1, Math.min(ALLOWANCE.most, Math.max(ALLOWANCE.least, fixedPace(facts.pattern ?? "walk", gait) / p.value)), learned!.strengths().pace);
}
