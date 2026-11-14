import type { ScoreEntry } from "./scorebook.js";

/**
 * How much a skill is worth right now: benefit weight × benefit − cost weight × cost.
 * DA sets the weights. High DA weighs benefit more and cost less (take on costly but rewarding
 * tasks); low DA does the opposite (stick to cheap, safe options). At rest (0.5) both weights
 * are 1, so a skill the scorebook has never seen (benefit 1, cost 1) is worth 0.
 *
 * TODO(dopamine): DA should also make the bot "move with more energy" (e.g. sprint only when DA
 * is high). Left for later; this only affects which skill is chosen.
 */
export function skillValue({ benefit, cost }: Pick<ScoreEntry, "benefit" | "cost">, da: number): number {
  return 2 * da * benefit - 2 * (1 - da) * cost;
}
