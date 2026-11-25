import type { Candidate, Workspace } from "@familiar/contracts";

// A term is one named reason a candidate's score goes up or down. The basal ganglia are given
// an ordered list of terms and nothing else: every rule about who wins is one of them.

/** go: adds to the score. no-go: scales it down (or up). gate: removes the candidate. */
export type TermKind = "go" | "no-go" | "gate";

export interface Term {
  name: string;
  kind: TermKind;
  /** The layers whose candidates it applies to. Default: all. */
  layers?: { from?: number; to?: number };
  /** The term whose strength this one scales, instead of the score itself. */
  on?: string;
  /**
   * go: what it adds (0: nothing). no-go: what the score is multiplied by (1: nothing).
   * gate: 0 or less removes the candidate. With `on`: what the other term's strength is multiplied by.
   * `vote` is everyone in the same contest (the candidate too), for a term that goes by the rivals.
   */
  amount(candidate: Candidate, ws: Workspace, vote: readonly Candidate[]): number;
  /** Its amount goes by who else is in the contest, so it is asked again for every contest. Default: asked once for each candidate in a choice. */
  byVote?: boolean;
  /** Turns the strength (the amount, after the terms that work on this one) into what is added or multiplied. Default: the strength itself. */
  shape?(strength: number, candidate: Candidate, ws: Workspace): number;
  /** Candidates it keeps in the vote though nobody proposed them this tick. Must not change anything. */
  recall?(candidates: readonly Candidate[], ws: Workspace): Candidate[];
  /** Told who won (the candidate as it stood in the vote) once the choice is final. */
  settled?(winner: Candidate | null, ws: Workspace): void;
}

/** What leaves a score as it was: nothing added, multiplied by one. */
export const neutral = (term: Term): number => (term.kind === "go" && !term.on ? 0 : 1);

export const appliesTo = (term: Term, candidate: Candidate): boolean => candidate.layer >= (term.layers?.from ?? -Infinity) && candidate.layer <= (term.layers?.to ?? Infinity);

/** The skill a candidate would run, or null (keep going, stop). */
export const skillOf = (candidate: Candidate): string | null => ("skill" in candidate.action ? candidate.action.skill : null);

/** Whether two candidates would do the same thing: the same skill at the same target (or both keep going, or both stop). */
export function sameAction(a: Candidate, b: Candidate): boolean {
  if ("skill" in a.action && "skill" in b.action) return a.action.skill === b.action.skill && a.action.target === b.action.target;
  return !("skill" in a.action) && !("skill" in b.action) && "stop" in a.action === "stop" in b.action;
}
