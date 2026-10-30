import type { Action, Answer } from "@familiar/contracts";

/** M0 rule: a "next_action" choice picks the skill; anything else means keep going. The Arbiter replaces this in M3. */
export function answersToAction(answers: Answer[]): Action {
  const next = answers.find((a) => a.kind === "choice" && a.id === "next_action");
  return next?.kind === "choice" ? { skill: next.choice } : { keepGoing: true };
}
