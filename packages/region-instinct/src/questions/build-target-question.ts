import type { Choice } from "@familiar/contracts";

export const TARGET_QUESTION_ID = "target";
export const NO_TARGET = "none";
/** A Choice may have at most 255 options; one is always "none". */
const MAX_TARGETS = 254;

/** "Which target?" over target ids (given nearest first), capped to fit, always ending with "none". */
export function buildTargetQuestion(targets: string[]): Choice {
  const unique = [...new Set(targets)].filter((t) => t !== NO_TARGET).slice(0, MAX_TARGETS);
  return {
    kind: "choice",
    id: TARGET_QUESTION_ID,
    prompt: `Which target should the chosen skill act on? Pick "${NO_TARGET}" if it needs no target.`,
    options: [...unique, NO_TARGET],
  };
}
