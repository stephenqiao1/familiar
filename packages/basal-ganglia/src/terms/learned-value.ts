import type { Workspace } from "@familiar/contracts";
import { skillOf, type Term } from "../term.js";

/** How much a learned value counts next to urgency. */
export const VALUE_WEIGHT = 0.2;

/** Go: what the skill has been learned to be worth here (benefit against cost, tilted by dopamine). */
export function learnedValue(options: { valueOf(skill: string, ws: Workspace): number; weight?: number }): Term {
  const weight = options.weight ?? VALUE_WEIGHT;
  return {
    name: "learned-value",
    kind: "go",
    amount: (candidate, ws) => {
      const skill = skillOf(candidate);
      return skill === null ? 0 : weight * options.valueOf(skill, ws);
    },
  };
}
