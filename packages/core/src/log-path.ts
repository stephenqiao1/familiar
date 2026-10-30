import { join } from "node:path";

/** logs/<role>-<ISO timestamp>.jsonl, with ":" swapped for "-" so the name is valid on every OS. */
export function defaultLogPath(role: string, now: Date = new Date(), dir = "logs"): string {
  const stamp = now.toISOString().replaceAll(":", "-");
  return join(dir, `${role}-${stamp}.jsonl`);
}
