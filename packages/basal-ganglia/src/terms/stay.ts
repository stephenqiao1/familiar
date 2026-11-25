import type { Workspace } from "@familiar/contracts";
import { skillOf, type Term } from "../term.js";

/** Go: the running skill is raised while it is getting somewhere, so a challenger must be clearly better. */
export function stay(options: { bonusOf(skill: string, ws: Workspace): number }): Term {
  return {
    name: "stay",
    kind: "go",
    amount: (candidate, ws) => {
      const skill = skillOf(candidate);
      return skill === null ? 0 : options.bonusOf(skill, ws);
    },
  };
}
