import type { Action, TickLog } from "@familiar/contracts";

/**
 * One console line per tick: what was done and which region won (with urgency and reason),
 * time to decide, the shared signals, a new goal if one arrived, region errors, and skill events. E.g.
 *   tick 12  attack (entity:42) <- reflex 1.00 "zombie 4 blocks away"  3ms  in_danger=0.81  | attack (entity:42) started
 */
export function formatTick(entry: TickLog): string {
  const parts = [`tick ${entry.tick}`, decision(entry), `${entry.decideMs.toFixed(0)}ms`];

  const signals = Object.entries(entry.signals).map(([name, s]) => `${name}=${s.value.toFixed(2)}`);
  if (signals.length) parts.push(signals.join(" "));

  const planned = entry.regions.find((r) => r.background && !r.error && entry.goal?.setBy === r.region);
  if (planned && entry.goal) parts.push(`new goal="${entry.goal.text}"`);

  const errors = entry.regions.filter((r) => r.error).map((r) => `${r.region}: ${r.error}`);
  if (errors.length) parts.push(`! ${errors.join("; ")}`);

  let line = parts.join("  ");
  if (entry.skillEvents?.length) {
    line += `  | ${entry.skillEvents.map((e) => `${e.skill}${e.target ? ` (${e.target})` : ""} ${e.type}${e.reason ? ` (${e.reason})` : ""}`).join(", ")}`;
  }
  return line;
}

function decision({ action, winner }: TickLog): string {
  if (!winner) return "keep going";
  return `${describe(action)} <- ${winner.region} ${winner.urgency.toFixed(2)} "${winner.reason}"`;
}

function describe(action: Action): string {
  if ("keepGoing" in action) return "keep going";
  return action.target ? `${action.skill} (${action.target})` : action.skill;
}
