import type { SkillEvent } from "@familiar/contracts";

/** One console line per skill event, e.g. "[skill] go_to (pos:1,2,3) failed: no path found within 10s". */
export function formatSkillEvent(event: SkillEvent): string {
  const target = event.target === undefined ? "" : ` (${event.target})`;
  const reason = event.reason === undefined ? "" : `: ${event.reason}`;
  return `[skill] ${event.skill}${target} ${event.type}${reason}`;
}

/** What a run changed, on one line, e.g. "moved 1.2, gained dirt×1, as expected". Empty if it reported nothing. */
export function formatChanges(event: SkillEvent): string {
  if (!event.changes) return "";
  const { asExpected, ...rest } = event.changes;
  const parts = Object.entries(rest).map(([key, value]) => `${key} ${show(value)}`);
  if (asExpected !== undefined) parts.push(asExpected ? "as expected" : "NOT as expected");
  return parts.join(", ");
}

function show(value: unknown): string {
  if (Array.isArray(value)) return `[${value.length}]`;
  if (value !== null && typeof value === "object") return Object.entries(value).map(([k, v]) => `${k}×${String(v)}`).join(" ");
  return String(value);
}
