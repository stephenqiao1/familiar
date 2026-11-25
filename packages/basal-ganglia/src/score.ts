import type { Candidate, Workspace } from "@familiar/contracts";
import { appliesTo, neutral, type Term } from "./term.js";

// Scoring: score = (urgency + every go term) × every no-go term. Pure: the same candidates,
// workspace and terms always give the same scores.

/** What one term did to one candidate: what it added (go) or multiplied by (no-go). */
export interface Effect {
  term: string;
  kind: "go" | "no-go";
  effect: number;
}

export interface Scored {
  candidate: Candidate;
  effects: Effect[];
  /** Everything the go terms added. */
  go: number;
  /** Everything the no-go terms multiplied by, as one factor. */
  noGo: number;
  score: number;
}

/** What a term adds or multiplies by for this candidate, after the terms that work on it (in the order listed). */
function effectOf(term: Term, terms: readonly Term[], candidate: Candidate, ws: Workspace, vote: readonly Candidate[]): number {
  let strength = term.amount(candidate, ws, vote);
  for (const other of terms) if (other.on === term.name && appliesTo(other, candidate)) strength *= other.amount(candidate, ws, vote);
  return term.shape ? term.shape(strength, candidate, ws) : strength;
}

/** `vote` is everyone in the same contest. Default: the candidate alone. */
export function score(candidate: Candidate, terms: readonly Term[], ws: Workspace, vote: readonly Candidate[] = [candidate]): Scored {
  const effects: Effect[] = [];
  let [sum, go, noGo] = [candidate.urgency, 0, 1];
  for (const term of terms) {
    if (term.kind === "gate" || term.on || !appliesTo(term, candidate)) continue;
    const effect = effectOf(term, terms, candidate, ws, vote);
    if (effect === neutral(term)) continue;
    effects.push({ term: term.name, kind: term.kind, effect });
    if (term.kind === "go") [sum, go] = [sum + effect, go + effect];
    else noGo *= effect;
  }
  return { candidate, effects, go, noGo, score: sum * noGo };
}
