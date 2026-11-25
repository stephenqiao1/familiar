import type { Workspace } from "@familiar/contracts";
import { skillOf, type Term } from "../term.js";

/** Gate, deciding layers only: a skill just given up on waits before it may be started again (a reflex may at once). */
export function givenUp(options: { heldBack(skill: string, ws: Workspace): boolean }): Term {
  return {
    name: "given-up",
    kind: "gate",
    layers: { from: 1 },
    amount: (candidate, ws) => {
      const skill = skillOf(candidate);
      return skill !== null && options.heldBack(skill, ws) ? 0 : 1;
    },
  };
}
