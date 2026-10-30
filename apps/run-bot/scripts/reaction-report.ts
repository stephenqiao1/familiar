// How fast the bot reacts to hostile mobs, from a tick log.
//   node apps/run-bot/scripts/reaction-report.ts [file]   (default: newest logs/*.jsonl)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { FirstSeen, TickLog } from "@familiar/contracts";
import { createFirstSeenTracker } from "@familiar/minecraft";

const REACTIONS = new Set(["attack", "flee"]);

const file = process.argv[2] ?? newestLog("logs");
const ticks = readFileSync(file, "utf8")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => JSON.parse(l) as TickLog);
if (ticks.length === 0) throw new Error(`${file} has no ticks`);

// Logs from before firstSeen was recorded: rebuild it from each tick's encoded mobs.
const recorded = ticks.some((t) => t.firstSeen !== undefined);
const track = createFirstSeenTracker();
const sightings = ticks.flatMap((t, i) => (recorded ? (t.firstSeen ?? []) : track(t.state)).map((seen) => ({ seen, from: i })));

console.log(`file: ${file}`);
console.log(`ticks: ${ticks.length}${recorded ? "" : "  (firstSeen not in this log; rebuilt from encoded states)"}\n`);

console.log("Reactions to new hostile mobs");
if (sightings.length === 0) console.log("  none seen");
for (const { seen, from } of sightings) console.log(`  ${describeReaction(seen, from)}`);

const jev = ticks.map((t) => t.engineLatencyMs);
const total = ticks.map(tickTime);
const minutes = (ticks.at(-1)!.timestamp - ticks[0]!.timestamp) / 60_000;
const encodeLogged = ticks.every((t) => t.encodeMs !== undefined);

console.log("\nWhole run");
console.log(`  engine latency     median ${ms(percentile(jev, 0.5))}  p90 ${ms(percentile(jev, 0.9))}`);
console.log(
  `  total tick time    median ${ms(percentile(total, 0.5))}  p90 ${ms(percentile(total, 0.9))}` +
    (encodeLogged ? "  (encode + decide + start skill)" : "  (encode time not in this log: decide + start skill only)"),
);
console.log(`  calls per minute   ${minutes > 0 ? (ticks.length / minutes).toFixed(1) : "n/a"}  over ${(minutes * 60).toFixed(0)}s`);

/** First attack/flee start at or after the sighting, and how long it took. */
function describeReaction(seen: FirstSeen, from: number): string {
  const what = `${seen.type} ${seen.mobId} first seen at ${seen.dist} blocks (tick ${ticks[from]!.tick})`;
  for (const t of ticks.slice(from)) {
    const start = t.skillEvents?.find((e) => e.type === "started" && REACTIONS.has(e.skill) && e.timestamp >= seen.timestamp);
    if (start) {
      return `${what} -> ${start.skill} started after ${start.timestamp - seen.timestamp} ms (tick ${t.tick}, engine latency ${ms(t.engineLatencyMs)})`;
    }
  }
  return `${what} -> no attack or flee before the log ends`;
}

/** Encode, plus decide and (if a skill started this tick) starting it; otherwise encode + decide. */
function tickTime(t: TickLog): number {
  const started = t.skillEvents?.find((e) => e.type === "started" && e.timestamp >= t.timestamp);
  const decideAndAct = started ? Math.max(started.timestamp - t.timestamp, t.engineLatencyMs) : t.engineLatencyMs;
  return (t.encodeMs ?? 0) + decideAndAct;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0;
}

function ms(value: number): string {
  return `${value.toFixed(0)} ms`;
}

function newestLog(dir: string): string {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!files[0]) throw new Error(`No .jsonl files in ${dir}/`);
  return files[0];
}
