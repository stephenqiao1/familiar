import type { Candidate, Workspace } from "@familiar/contracts";
import { skillOf, type Term } from "../term.js";

/** No-go, deciding layers only: while something is wanted, an option is held back by the worst need it is not expected to relieve. */
export function holdForWant(options: { holdOf(skill: string, candidate: Candidate, ws: Workspace): number }): Term {
  return {
    name: "hold-for-want",
    kind: "no-go",
    layers: { from: 1 },
    amount: (candidate, ws) => {
      const skill = skillOf(candidate);
      return skill === null ? 1 : options.holdOf(skill, candidate, ws);
    },
  };
}
