import type { Answer, Question } from "@familiar/contracts";
import { JevError } from "./jev-error.js";
import { levelToScore } from "./score-scale.js";

/** One answer as Jev returns it (the fields we read). */
type JevAnswer =
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: "score"; score: number; confidence: number }
  | { type: "noul"; noul: number }
  | { type: string };

/** Jev's answers (keyed by question id) as our Answer[], in the same order as the questions. */
export function fromJevAnswers(questions: Question[], answers: Record<string, JevAnswer | undefined>): Answer[] {
  return questions.map((q): Answer => {
    const a = answers[q.id];
    if (!a || a.type !== q.kind) {
      throw new JevError(`Jev returned ${a ? `a ${a.type} answer` : "no answer"} for ${q.kind} "${q.id}"`);
    }
    if (q.kind === "choice" && "choice" in a) {
      return { kind: "choice", id: q.id, choice: a.choice, probabilities: { ...a.probabilities }, confidence: a.confidence };
    }
    if (q.kind === "score" && "score" in a) {
      return { kind: "score", id: q.id, score: levelToScore(q, a.score), confidence: a.confidence };
    }
    if (q.kind === "noul" && "noul" in a) {
      return { kind: "noul", id: q.id, value: a.noul };
    }
    throw new JevError(`Malformed ${q.kind} answer for "${q.id}"`);
  });
}
