import type { Action, Answer } from "@familiar/contracts";
import { NO_TARGET, TARGET_QUESTION_ID } from "./questions/build-target-question.js";

/** Runs `skill`, with the "target" choice attached when it isn't "none" and the skill accepts it. */
export function actionFor(skill: string, answers: Answer[], acceptsTarget?: (skill: string, target: string) => boolean): Action {
  const target = answers.find((a) => a.kind === "choice" && a.id === TARGET_QUESTION_ID);
  if (target?.kind !== "choice" || target.choice === NO_TARGET || !acceptsTarget?.(skill, target.choice)) return { skill };
  return { skill, target: target.choice };
}
