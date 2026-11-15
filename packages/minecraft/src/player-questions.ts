import type { Choice, Question } from "@familiar/contracts";

// Every question the player asks each tick, in order.
// next_action and target depend on the moment (runnable skills, visible targets), so they are
// built each tick by the caller and passed in; the rest are fixed.

/** Who the player is and what comes first; put before the next_action question. */
export const PLAYER_CONTEXT =
  "The player is a Minecraft bot. Staying alive comes first: when a hostile mob that can reach " +
  "the player is within 8 blocks, attack it (if healthy and armed) or flee before doing anything " +
  "else. Do not flee from or attack a hostile mob that is more than 8 blocks away or cannot reach " +
  "the player: it only needs watching, so keep doing what you were doing.";

export const IN_DANGER: Question = {
  kind: "noul",
  id: "in_danger",
  statement: "The player is in immediate danger.",
};

export const RETURN_TO_BASE: Question = {
  kind: "noul",
  id: "return_to_base",
  statement: "The player should head back to base now.",
};

/** The player's full question set for one tick. */
export function playerQuestions(built: { nextAction: Choice; target: Choice }): Question[] {
  return [built.nextAction, built.target, IN_DANGER, RETURN_TO_BASE];
}
