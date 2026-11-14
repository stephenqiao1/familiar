import type { Choice, Skill } from "@familiar/contracts";

export const ACTION_QUESTION_ID = "next_action";

/**
 * "Which skill next?", offering only skills that can run right now. Each option's one-line
 * description goes into the prompt so the decision model knows what it means.
 * A skill whose canRun throws is treated as unable to run. `context` (who the player is, what
 * comes first) is put before the question. The skill already `running` is always offered, marked
 * as the one in progress: many skills cannot be started again while they run (sleeping while
 * asleep), and leaving one off the menu would force a switch away from it.
 */
export function buildActionQuestion<Ctx>(skills: Skill<Ctx>[], ctx: Ctx, context?: string, running?: string): Choice {
  const runnable = skills.filter((skill) => {
    if (skill.name === running) return true;
    try {
      return skill.canRun(ctx);
    } catch {
      return false;
    }
  });
  const menu = runnable.map((s) => `- ${s.name}: ${s.description}${s.name === running ? " (in progress: choose it to keep going)" : ""}`).join("\n");
  return {
    kind: "choice",
    id: ACTION_QUESTION_ID,
    prompt: `${context ? `${context}\n` : ""}Which skill should the player do next?\n${menu}`,
    options: runnable.map((s) => s.name),
  };
}
