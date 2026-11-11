import type { Arbiter, Candidate } from "@familiar/contracts";

/** The most urgent candidate; on a tie, the one from the faster (lower) layer; then the first listed. */
export const highestUrgency: Arbiter = {
  name: "highest-urgency",

  pick(candidates) {
    let best: Candidate | null = null;
    for (const c of candidates) if (!best || beats(c, best)) best = c;
    return best;
  },

  // Nothing still running can beat a full-urgency (1) candidate unless it is from a faster layer.
  settledEarly(candidates, pendingLayers) {
    const best = this.pick(candidates);
    if (!best || best.urgency < 1) return null;
    return pendingLayers.every((layer) => layer >= best.layer) ? best : null;
  },
};

function beats(a: Candidate, b: Candidate): boolean {
  if (a.urgency !== b.urgency) return a.urgency > b.urgency;
  return a.layer < b.layer;
}
