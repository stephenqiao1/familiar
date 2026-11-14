import type { Proposal } from "@familiar/contracts";
import { skillValue } from "./effort.js";
import type { Scorebook } from "./scorebook.js";

/** Something in view the bot could head to: its target id and what kind of thing it is. */
export interface Thing {
  id: string;
  kind: string;
}

/** A cue that fired: a thing in view that heading toward has paid off before. */
export interface Cue {
  thing: Thing;
  skill: string;
  boost: number;
}

/** The highest urgency a cue can give; confident picks from other regions still win. */
export const MAX_CUE_URGENCY = 0.3;

/** The scorebook key for running `skill` aimed at a kind of thing, e.g. "go_to→chest". */
export function towardKey(skill: string, kind: string): string {
  return `${skill}→${kind}`;
}

/**
 * Wanting what it sees: for the nearest thing of each kind in view, each skill that heads toward
 * it gets a boost equal to its learned value there (benefit and cost weighed by DA), if heading
 * there is linked to past reward (a positive learned expectation) and the value is positive.
 * Each boost becomes a proposal to head there, with urgency capped at MAX_CUE_URGENCY.
 */
export function cueProposals(input: {
  things: Thing[];
  situation: string;
  da: number;
  scorebook: Scorebook;
  skillsToward(thing: Thing): string[];
}): { cues: Cue[]; proposals: Proposal[] } {
  const { things, situation, da, scorebook, skillsToward } = input;
  const nearestOfEachKind = things.filter((t, i) => things.findIndex((u) => u.kind === t.kind) === i);
  const cues: Cue[] = [];
  for (const thing of nearestOfEachKind) {
    for (const skill of skillsToward(thing)) {
      const entry = scorebook.get(situation, towardKey(skill, thing.kind));
      const boost = skillValue(entry, da);
      if (entry.expected > 0 && boost > 0) cues.push({ thing, skill, boost });
    }
  }
  const proposals = cues.map(({ thing, skill, boost }) => ({
    action: { skill, target: thing.id },
    urgency: Math.min(MAX_CUE_URGENCY, boost),
    reason: `wants the ${thing.kind} (learned value ${boost.toFixed(2)})`,
  }));
  return { cues, proposals };
}
