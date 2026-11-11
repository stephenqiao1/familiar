// Summarises a tick log: node apps/run-bot/scripts/check-log.ts [file]  (default: newest logs/*.jsonl)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { TickLog } from "@familiar/contracts";

function latestLog(dir: string): string {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!files[0]) throw new Error(`No .jsonl files in ${dir}/`);
  return files[0];
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const file = process.argv[2] ?? latestLog("logs");
const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "");
const entries: TickLog[] = [];
const problems: string[] = [];

lines.forEach((line, i) => {
  try {
    entries.push(JSON.parse(line) as TickLog);
  } catch {
    problems.push(`line ${i + 1}: invalid JSON`);
  }
});

// A tick that throws is not logged but still uses up its number, so a gap means an error.
for (let i = 1; i < entries.length; i++) {
  const prev = entries[i - 1]!.tick;
  const cur = entries[i]!.tick;
  if (cur !== prev + 1) problems.push(`ticks ${prev + 1}–${cur - 1}: missing (tick errored)`);
}
if (entries[0] && entries[0].tick !== 0) problems.push(`ticks 0–${entries[0].tick - 1}: missing (tick errored)`);

const latencies = entries.map((e) => e.decideMs);
const span = entries.length > 1 ? (entries.at(-1)!.timestamp - entries[0]!.timestamp) / 1000 : 0;

console.log(`file:     ${file}`);
console.log(`lines:    ${lines.length} (${entries.length} valid JSON)`);
console.log(`ticks:    ${entries.length} over ${span.toFixed(1)}s`);
if (latencies.length) {
  console.log(`decide:   median ${median(latencies).toFixed(3)}ms, max ${Math.max(...latencies).toFixed(3)}ms`);
}
console.log(problems.length ? `errors:\n  ${problems.join("\n  ")}` : "errors:   none");
process.exitCode = problems.length ? 1 : 0;
