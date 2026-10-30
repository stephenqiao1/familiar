import type { Question } from "@familiar/contracts";
import { JevError } from "./jev-error.js";

export const MAX_CHOICE_OPTIONS = 255;

/** Throws a JevError for questions Jev can't answer, before anything is sent. */
export function validateQuestions(questions: Question[]): void {
  if (questions.length === 0) throw new JevError("No questions to ask");
  const seen = new Set<string>();
  for (const q of questions) {
    if (seen.has(q.id)) throw new JevError(`Duplicate question id "${q.id}"`);
    seen.add(q.id);
    if (q.kind === "choice" && (q.options.length === 0 || q.options.length > MAX_CHOICE_OPTIONS)) {
      throw new JevError(`Choice "${q.id}" has ${q.options.length} options; Jev needs 1 to ${MAX_CHOICE_OPTIONS}`);
    }
    if (q.kind === "choice" && new Set(q.options).size !== q.options.length) {
      throw new JevError(`Choice "${q.id}" has duplicate options`);
    }
    if (q.kind === "score" && !(q.max > q.min)) {
      throw new JevError(`Score "${q.id}" needs max > min (got ${q.min}..${q.max})`);
    }
  }
}
