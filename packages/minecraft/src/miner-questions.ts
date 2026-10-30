import type { Choice, Question } from "@familiar/contracts";

// Every question the Miner asks each tick, in order. M3 moves these into miner.yaml.
// next_action and target depend on the moment (runnable skills, visible targets), so they are
// built each tick by the caller and passed in; the rest are fixed.

/** Who the player is and what comes first; put before the next_action question. */
export const MINER_CONTEXT =
  "The player is a Minecraft miner bot. Staying alive comes first: when a hostile mob is within " +
  "16 blocks, attack it (if healthy and armed) or flee before doing anything else.";

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

export const MINING_SPOT_QUALITY: Question = {
  kind: "score",
  id: "mining_spot_quality",
  prompt: "How good is the player's current spot for finding ore? 0 = hopeless, 10 = excellent.",
  min: 0,
  max: 10,
};

/** The Miner's full question set for one tick. */
export function minerQuestions(built: { nextAction: Choice; target: Choice }): Question[] {
  return [built.nextAction, built.target, IN_DANGER, RETURN_TO_BASE, MINING_SPOT_QUALITY];
}
