import type { Candidate, Workspace } from "@familiar/contracts";
import { sameAction, type Term } from "../term.js";

export interface RestYieldsOptions {
  /** How far, 0 to 1 (0: not at all; 1: a decider's rest is out of the vote while a step is offered). */
  strength: number;
  /** Whether a candidate is a step of the goal being carried out (the motor area's proposal). */
  step(candidate: Candidate): boolean;
  /** Whether a candidate is a decider choosing to do nothing with the body (idling). */
  rests(candidate: Candidate, ws: Workspace): boolean;
}

/**
 * Doing nothing yields to a step in hand. While a step of the goal is in the vote, a decider's
 * choice to rest is scaled by (1 − strength): idling is what a decider says when it sees nothing
 * to do, and the plan has just said what there is to do. Anything else a decider chooses (to
 * eat, to run, to go home) competes with the step as it always did, and so does every request of the body.
 */
export function restYields({ strength, step, rests }: RestYieldsOptions): Term {
  return {
    name: "rest-yields",
    kind: "no-go",
    byVote: true,
    amount(candidate, ws, vote) {
      if (strength <= 0 || step(candidate) || !rests(candidate, ws)) return 1;
      return vote.some((other) => step(other) && !sameAction(other, candidate)) ? 1 - Math.min(1, strength) : 1;
    },
  };
}
