import type { Candidate, Workspace } from "@familiar/contracts";
import { skillOf, type Term } from "../term.js";

/**
 * No-go, deciding layers only: the patience brake. Its strength is how costly the option has
 * been learned to be; `brake` turns that into a factor (below 1 holds back, above 1 lets loose).
 */
export function restraint(options: { strengthOf(skill: string, candidate: Candidate, ws: Workspace): number; brake(strength: number, ws: Workspace): number }): Term {
  return {
    name: "restraint",
    kind: "no-go",
    layers: { from: 1 },
    amount: (candidate, ws) => {
      const skill = skillOf(candidate);
      return skill === null ? 0 : options.strengthOf(skill, candidate, ws);
    },
    shape: (strength, candidate, ws) => (skillOf(candidate) === null ? 1 : options.brake(strength, ws)),
  };
}
