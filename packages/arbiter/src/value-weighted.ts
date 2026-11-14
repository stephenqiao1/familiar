import type { Arbiter, Candidate, Workspace } from "@familiar/contracts";
import { highestUrgency, mostUrgent } from "./highest-urgency.js";

export interface ValueWeightedOptions {
  /** What a skill is worth right now (e.g. from what dopamine has learned). 0 = no opinion. */
  valueOf(skill: string, ws: Workspace): number;
  /** How much value counts next to urgency. Default: 0.2. */
  weight?: number;
  /** Added to a skill's score (e.g. for staying with the running skill). Default: 0. */
  bonusOf?(skill: string, ws: Workspace): number;
  /** Multiplies a skill's score (e.g. a brake on risky skills). Default: 1. */
  scaleOf?(skill: string, ws: Workspace): number;
}

/**
 * Picks by (urgency + weight × value + bonus) × scale of the candidate's skill; ties go to the faster
 * layer. A full-urgency candidate (e.g. a fight-or-flight reflex) always wins, whatever the values
 * and scales, so nothing learned or felt can stop the bot from saving itself. The winner's reason
 * notes its value, and its bonus and scale when they change anything.
 */
export function createValueWeightedArbiter({ valueOf, weight = 0.2, bonusOf = () => 0, scaleOf = () => 1 }: ValueWeightedOptions): Arbiter {
  return {
    name: "value-weighted",

    pick(candidates, ws) {
      const urgent = candidates.filter((c) => c.urgency >= 1);
      if (urgent.length) return mostUrgent(urgent);
      let best: { candidate: Candidate; value: number; bonus: number; scale: number; score: number } | null = null;
      for (const candidate of candidates) {
        const skill = "skill" in candidate.action ? candidate.action.skill : null;
        const value = skill === null ? 0 : valueOf(skill, ws);
        const bonus = skill === null ? 0 : bonusOf(skill, ws);
        const scale = skill === null ? 1 : scaleOf(skill, ws);
        const score = (candidate.urgency + weight * value + bonus) * scale;
        if (!best || score > best.score || (score === best.score && candidate.layer < best.candidate.layer)) {
          best = { candidate, value, bonus, scale, score };
        }
      }
      if (!best) return null;
      const bonus = best.bonus === 0 ? "" : `; bonus +${best.bonus.toFixed(2)}`;
      const scaled = best.scale === 1 ? "" : `; scaled ×${best.scale.toFixed(2)}`;
      return { ...best.candidate, reason: `${best.candidate.reason}; value ${best.value.toFixed(2)}${bonus}${scaled}` };
    },

    settledEarly: (candidates, pendingLayers, ws) => highestUrgency.settledEarly!(candidates, pendingLayers, ws),
  };
}
