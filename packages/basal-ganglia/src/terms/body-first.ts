import type { Candidate, Workspace } from "@familiar/contracts";
import { sameAction, type Term } from "../term.js";

/** How much of a rival's score a full-urgency request of the body would take off. */
export const BODY_FIRST = 0.25;

export interface BodyFirstOptions {
  /** How strongly, 0 to 1 (0: not at all). */
  strength: number;
  /** Whether a candidate is a request of the body itself (a reflex, an urge). Default: any from layer 0. */
  body?(candidate: Candidate): boolean;
  /** Whether two candidates would use the same part of the body. Default: always. */
  clash?(a: Candidate, b: Candidate, ws: Workspace): boolean;
}

/**
 * The body's requests hold back the deciders' rivals. While a request of the body is in the vote
 * with urgency u, every option of a deciding layer that would use the same body parts and is a
 * different action is scaled by (1 − 0.25 × u): the stronger the reflex, the more clearly a
 * decider must want something else to override it.
 */
export function bodyFirst({ strength, body = (c) => c.layer === 0, clash = () => true }: BodyFirstOptions): Term {
  return {
    name: "body-first",
    kind: "no-go",
    layers: { from: 1 },
    byVote: true,
    amount(candidate, ws, vote) {
      if (strength <= 0) return 1;
      const u = Math.max(0, ...vote.filter((other) => body(other) && !sameAction(other, candidate) && clash(other, candidate, ws)).map((other) => other.urgency));
      return 1 - BODY_FIRST * strength * u;
    },
  };
}
