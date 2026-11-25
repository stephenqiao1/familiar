import type { Candidate, Workspace } from "@familiar/contracts";
import { score, type Scored } from "./score.js";
import { appliesTo, type Term } from "./term.js";

// One contest: who is in the vote, and who wins it. Pure, so it can be run again with a term
// left out to see whether that term decided the outcome.

export interface Removed {
  candidate: Candidate;
  by: string;
}

/** Who is in the vote, before anyone is scored. */
export interface Entered {
  pool: Candidate[];
  removed: Removed[];
  /** Candidates kept in the vote by a term, though nobody proposed them this tick. */
  recalled: Candidate[];
}

/** One contest among those in the vote. */
export interface Settled {
  /** Everyone in the contest, scored (empty when a full-urgency candidate settled it). */
  scored: Scored[];
  /** The winner as it stood in the vote, or null. */
  winner: Candidate | null;
  /** A full-urgency candidate won outright: no term was asked. */
  urgent: boolean;
}

export type Contest = Entered & Settled;

/** The most urgent; on a tie, the one from the faster (lower) layer; then the first listed. */
export function mostUrgent(candidates: readonly Candidate[]): Candidate | null {
  let best: Candidate | null = null;
  for (const c of candidates) if (!best || c.urgency > best.urgency || (c.urgency === best.urgency && c.layer < best.layer)) best = c;
  return best;
}

/** Gates first (a removed candidate is in no vote), then whatever a term keeps in the vote. */
export function enter(candidates: readonly Candidate[], terms: readonly Term[], ws: Workspace): Entered {
  const removed: Removed[] = [];
  const kept = candidates.filter((candidate) => {
    const gate = terms.find((term) => term.kind === "gate" && appliesTo(term, candidate) && term.amount(candidate, ws, candidates) <= 0);
    if (gate) removed.push({ candidate, by: gate.name });
    return !gate;
  });
  const recalled = terms.flatMap((term) => term.recall?.(kept, ws) ?? []);
  return { pool: [...kept, ...recalled], removed, recalled };
}

/** The contest itself: a full-urgency candidate wins at once; otherwise the highest score, ties to the faster layer, then the first listed. */
export function settle(pool: readonly Candidate[], terms: readonly Term[], ws: Workspace): Settled {
  // A full-urgency candidate always wins at once: no term touches it.
  const urgent = pool.filter((c) => c.urgency >= 1);
  if (urgent.length) return { scored: [], winner: mostUrgent(urgent), urgent: true };
  const scored = pool.map((candidate) => score(candidate, terms, ws, pool));
  let best: Scored | null = null;
  for (const s of scored) if (!best || s.score > best.score || (s.score === best.score && s.candidate.layer < best.candidate.layer)) best = s;
  return { scored, winner: best?.candidate ?? null, urgent: false };
}

/** One contest among all the candidates. */
export function contest(candidates: readonly Candidate[], terms: readonly Term[], ws: Workspace): Contest {
  const entered = enter(candidates, terms, ws);
  return { ...entered, ...settle(entered.pool, terms, ws) };
}

/** The terms that did something in a contest: scored someone, removed someone, or kept someone in the vote. */
export function acted(terms: readonly Term[], entered: Entered, contests: readonly Settled[]): Term[] {
  const names = new Set([...contests.flatMap((c) => c.scored.flatMap((s) => s.effects.map((e) => e.term))), ...entered.removed.map((r) => r.by)]);
  return terms.filter((term) => names.has(term.name) || (term.recall !== undefined && entered.recalled.length > 0));
}

/** The same terms without one of them (and without the terms that work on it). */
export const without = (terms: readonly Term[], term: Term): Term[] => terms.filter((t) => t !== term && t.on !== term.name);

/** The terms without which somebody else would have won (or nobody). A term goes together with the terms that work on it. */
export function decidedBy(candidates: readonly Candidate[], terms: readonly Term[], ws: Workspace, result: Contest): string[] {
  if (result.urgent || !result.winner) return [];
  return acted(terms, result, [result])
    .filter((term) => contest(candidates, without(terms, term), ws).winner !== result.winner)
    .map((term) => term.name);
}
