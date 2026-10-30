import type { TickLog } from "@familiar/contracts";

/** One short console line: tick, action, engine latency. */
export function formatTick(entry: TickLog): string {
  const action = "keepGoing" in entry.action ? "keep going" : entry.action.skill;
  return `tick ${entry.tick}  ${action}  ${entry.engineLatencyMs.toFixed(1)}ms`;
}
