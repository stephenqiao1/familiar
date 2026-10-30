import type { Action, Answer } from "@familiar/contracts";
import { ACTION_QUESTION_ID } from "./questions/build-action-question.js";
import { NO_TARGET, TARGET_QUESTION_ID } from "./questions/build-target-question.js";

/**
 * M0–M2 rule (the Arbiter replaces this in M3): the next_action choice picks the skill; anything
 * else means keep going. The "target" choice is attached when it isn't "none" and
 * `acceptsTarget(skill, target)` says the skill can use it.
 */
export function answersToAction(answers: Answer[], acceptsTarget?: (skill: string, target: string) => boolean): Action {
  const next = choiceOf(answers, ACTION_QUESTION_ID);
  if (next === undefined) return { keepGoing: true };
  const target = choiceOf(answers, TARGET_QUESTION_ID);
  if (target === undefined || target === NO_TARGET || !acceptsTarget?.(next, target)) return { skill: next };
  return { skill: next, target };
}

function choiceOf(answers: Answer[], id: string): string | undefined {
  const answer = answers.find((a) => a.kind === "choice" && a.id === id);
  return answer?.kind === "choice" ? answer.choice : undefined;
}
