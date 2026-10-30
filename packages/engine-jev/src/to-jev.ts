import type { Question } from "@familiar/contracts";
import { choice, noul, score, type Questions } from "@typesafe-ai/sdk";
import { scoreLevels } from "./score-scale.js";

/** Our questions as Jev's named questions, keyed by question id. */
export function toJevQuestions(questions: Question[]): Questions {
  const named: Questions = {};
  for (const q of questions) {
    switch (q.kind) {
      case "choice":
        named[q.id] = choice(q.prompt, Object.fromEntries(q.options.map((o) => [o, null])));
        break;
      case "score":
        named[q.id] = score(q.prompt, scoreLevels(q));
        break;
      case "noul":
        named[q.id] = noul(q.statement);
        break;
    }
  }
  return named;
}
