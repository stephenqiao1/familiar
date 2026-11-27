import type { Feedback, Workspace } from "@familiar/contracts";

/**
 * What the nearest area above `area` on the ladder (lowest first) is telling the areas below it,
 * or null when none above has said anything. An area left out of the brain says nothing, so the
 * feedback of the next one up passes straight through.
 */
export function feedbackFor(
  ws: Workspace,
  area: string,
  ladder: readonly string[],
): Feedback | null {
  const at = ladder.indexOf(area);
  if (at < 0) return null;
  for (const above of ladder.slice(at + 1)) {
    const feedback = ws.cortex[above]?.feedback;
    if (feedback) return feedback;
  }
  return null;
}
