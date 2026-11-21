import type { Proposal } from "@familiar/contracts";
import type { Aim, Scorebook } from "./scorebook.js";
import { effortOf, reliefOf, wantNow, type NeedLevels } from "./wanting.js";

/** Something the bot could head to, in view or remembered: its target id and what kind of thing it is. */
export interface Thing {
  id: string;
  kind: string;
  /** It stays where it is (a chest, not a cow), so what is learned about this one can be kept under its id. Default: false. */
  fixed?: boolean;
  /** Work to reach it beyond what a trip to it usually takes, in reward units (a remembered thing a long walk off). Default: 0. */
  extraWork?: number;
}

/** A cue that fired: a thing in view that heading toward would pay right now. */
export interface Cue {
  thing: Thing;
  skill: string;
  /** What heading there is expected to pay right now, less the work of getting there, in reward units. */
  want: number;
  /** Each need's part of it, by the name of its rule. */
  needs: Record<string, number>;
}

/** The highest urgency a cue can give: below a hard reflex (1), which nothing wanted can stop. */
export const MAX_CUE_URGENCY = 0.9;

/** How the scorebook files a thing: by kind, and by its own id if it stays put. */
export function aimAt(thing: Thing): Aim {
  return { kind: thing.kind, ...(thing.fixed ? { id: thing.id } : {}) };
}

/**
 * Wanting what it sees. Every thing in view is weighed by itself (this chest, not chests in
 * general), for each skill that heads toward it:
 *   want = for each need, what the relief learned for heading there would pay right now
 *          (see wantNow), less the work the trip usually takes, less what aiming at this thing
 *          has been learned to cost (deaths, harm).
 * So the pull is as strong as the need: the same chest of bread pulls hard with no food left and
 * not at all with enough; and a thing is wanted only if it would pay more than the trouble of
 * getting to it, so a far one is given up on sooner than a near one, and a remembered one a
 * long walk off (its `extraWork`) is wanted only when the need presses hard. Only a need that aiming at this thing (its kind, or this one) has been
 * learned to relieve counts, so a skill that pays in general does not make everything wanted.
 * For each kind of thing and skill the most wanted in view wins (the nearest if equal) and
 * becomes a proposal to head there. Its urgency is the want itself, scaled by DA (×1 at rest;
 * low DA wants less) and by `strength`, and capped at MAX_CUE_URGENCY.
 */
export function cueProposals(input: {
  /** Nearest first. */
  things: Thing[];
  situation: string;
  da: number;
  /** How pressing each need is right now. */
  needs: NeedLevels;
  scorebook: Scorebook;
  skillsToward(thing: Thing): string[];
  /** Scales the urgency (0: wants nothing). Default: 1. */
  strength?: number;
}): { cues: Cue[]; proposals: Proposal[] } {
  const { things, situation, da, needs, scorebook, skillsToward, strength = 1 } = input;
  const best = new Map<string, Cue>();
  for (const thing of things) {
    const aim = aimAt(thing);
    for (const skill of skillsToward(thing)) {
      // A need counts only if aiming here has been learned to change it; then by all that is known of the run.
      const { want: pays, parts } = wantNow(needs, (need) => {
        const relief = reliefOf(skill, need);
        const aimed = scorebook.aimed(relief, aim).expected;
        const total = scorebook.get(situation, relief, aim).expected;
        return aimed === 0 ? 0 : aimed > 0 ? total : Math.min(0, total);
      });
      const work = Math.max(0, scorebook.get(situation, effortOf(skill), aim).expected) + (thing.extraWork ?? 0);
      const want = pays - work + Math.min(0, scorebook.aimed(skill, aim).expected);
      if (!(want > 0)) continue;
      const key = `${skill}\n${thing.kind}`;
      if (want > (best.get(key)?.want ?? 0)) best.set(key, { thing, skill, want, needs: parts });
    }
  }
  const cues = [...best.values()];
  const proposals = cues
    .map(({ thing, skill, want, needs }) => ({
      action: { skill, target: thing.id },
      urgency: Math.min(MAX_CUE_URGENCY, want * 2 * da * strength),
      reason: `wants the ${thing.kind} (${Object.entries(needs).map(([need, pays]) => `${need} ${pays.toFixed(2)}`).join(", ")})`,
    }))
    .filter((p) => p.urgency > 0);
  return { cues, proposals };
}
