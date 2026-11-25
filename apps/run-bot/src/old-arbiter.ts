import { createValueWeightedArbiter } from "@familiar/arbiter";
import type { Arbiter, Candidate, Workspace } from "@familiar/contracts";
import { selectionInputs, type SelectionParts } from "./selection-inputs.js";

/**
 * The arbiter as it was before the basal ganglia, kept for comparison (the tests and
 * `pnpm replay-selection` check that the basal ganglia pick the same winner). It reads the same
 * inputs and puts them together the old way: (urgency + 0.2 × value + bonus) × scale, with the
 * given-up filter and the standing choice wrapped around it.
 */
export function createOldArbiter<Ctx>(parts: SelectionParts<Ctx>): Arbiter {
  const inputs = selectionInputs(parts);
  const modulated = (skill: string, ws: Workspace, candidate: Candidate) => {
    if (candidate.layer < 1) return 1;
    return inputs.holdOf(skill, candidate, ws) * inputs.brake(inputs.brakeStrengthOf(skill, candidate, ws) * (1 - inputs.desperateEases * inputs.desperateOf(ws)), ws);
  };
  const arbiter = createValueWeightedArbiter({
    valueOf: inputs.valueOf,
    bonusOf: (skill, ws) => inputs.stayOf(skill) * inputs.switchingOf(ws) * (1 - inputs.urgeOf(ws)),
    scaleOf: modulated,
  });
  let standing: Candidate | null = null;
  return {
    ...arbiter,
    pick(candidates, ws) {
      candidates = candidates.filter((c) => !(c.layer >= 1 && "skill" in c.action && inputs.heldBack(c.action.skill)));
      const kept = standing;
      const silent = kept !== null && "skill" in kept.action && ws.current?.skill === kept.action.skill && !candidates.some((c) => c.region === kept.region);
      const winner = arbiter.pick(silent ? [...candidates, kept] : candidates, ws);
      const chosen = winner && [...candidates, ...(silent ? [kept] : [])].find((c) => c.region === winner.region && c.action === winner.action);
      if (chosen && chosen.layer >= 1 && "skill" in chosen.action) standing = chosen === kept ? kept : { ...chosen, reason: `${chosen.reason} (still under way)` };
      return winner;
    },
  };
}
