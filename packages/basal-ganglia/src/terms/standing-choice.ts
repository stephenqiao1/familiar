import type { Candidate } from "@familiar/contracts";
import { skillOf, type Term } from "../term.js";

/**
 * Keeps the running skill in the vote. A deciding layer is not asked every tick; while the one
 * that chose the running skill says nothing, its choice stands as it was made, so the skill is
 * not dropped for whatever else happens to speak. Once that layer speaks again, what it says counts.
 */
export function standingChoice(): Term {
  let standing: Candidate | null = null;
  return {
    name: "standing-choice",
    kind: "go",
    amount: () => 0,
    recall(candidates, ws) {
      const kept = standing;
      const silent = kept !== null && ws.current?.skill === skillOf(kept) && !candidates.some((c) => c.region === kept.region);
      return silent && kept ? [kept] : [];
    },
    settled(winner) {
      if (!winner || winner.layer < 1 || skillOf(winner) === null) return;
      standing = winner === standing ? winner : { ...winner, reason: `${winner.reason} (still under way)` };
    },
  };
}
