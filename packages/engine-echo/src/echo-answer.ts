import type { Answer, Choice, ChoiceAnswer, Question } from "@familiar/contracts";

/** The fixed, always-valid answer EchoEngine gives to one question. */
export function echoAnswer(question: Question): Answer {
  switch (question.kind) {
    case "choice":
      return echoChoice(question);
    case "score":
      return {
        kind: "score",
        id: question.id,
        score: (question.min + question.max) / 2,
        confidence: 1,
      };
    case "noul":
      return { kind: "noul", id: question.id, value: 0 };
  }
}

function echoChoice(question: Choice): ChoiceAnswer {
  const choice = question.options.includes("idle") ? "idle" : question.options[0];
  if (choice === undefined) {
    throw new Error(`Choice question "${question.id}" has no options`);
  }
  return {
    kind: "choice",
    id: question.id,
    choice,
    probabilities: { [choice]: 1 },
    confidence: 1,
  };
}
