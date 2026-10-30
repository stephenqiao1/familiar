import type { SkillEvent } from "@familiar/contracts";

/** One console line per skill event, e.g. "[skill] go_to (pos:1,2,3) failed: no path found within 10s". */
export function formatSkillEvent(event: SkillEvent): string {
  const target = event.target === undefined ? "" : ` (${event.target})`;
  const reason = event.reason === undefined ? "" : `: ${event.reason}`;
  return `[skill] ${event.skill}${target} ${event.type}${reason}`;
}
