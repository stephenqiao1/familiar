// Summarises a run's tick log for checking the neuromodulators: each dial's range, what moved it,
// rewards, surprises, memories, interrupts, warnings and region errors.
// Usage: pnpm brain-report [logs/player-....jsonl]   (default: the newest player log)
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface RegionLog {
  region: string;
  proposals: { action: { skill?: string; target?: string }; urgency: number; reason: string }[];
  trace?: Record<string, unknown>;
  error?: string;
}
interface Tick {
  tick: number;
  timestamp: number;
  regions: RegionLog[];
  winner: { region: string; reason: string; action: { skill?: string } } | null;
  action: { skill?: string; target?: string; keepGoing?: boolean };
  goal: { text: string; setBy: string; stepsDone: number; steps: string[]; wants: unknown[]; watchFor: string[] } | null;
  signals: Record<string, { value: number }>;
  skillEvents?: { skill: string; type: string; reason?: string; target?: string }[];
}

const file = process.argv[2] ?? newestLog();
const ticks: Tick[] = readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Tick);
if (ticks.length === 0) throw new Error(`${file} has no ticks`);
const seconds = (ticks.at(-1)!.timestamp - ticks[0]!.timestamp) / 1000;
console.log(`${file}\n${ticks.length} ticks over ${seconds.toFixed(0)} s (${(ticks.length / Math.max(1, seconds)).toFixed(1)} ticks/s)\n`);

function newestLog(): string {
  const logs = readdirSync("logs").filter((f) => f.startsWith("player-")).sort();
  if (logs.length === 0) throw new Error("No player logs in logs/");
  return join("logs", logs.at(-1)!);
}

const trace = (t: Tick, region: string) => t.regions.find((r) => r.region === region)?.trace ?? {};
const count = <T>(items: T[], key: (item: T) => string) => {
  const out = new Map<string, number>();
  for (const item of items) out.set(key(item), (out.get(key(item)) ?? 0) + 1);
  return [...out].sort((a, b) => b[1] - a[1]);
};
const list = (pairs: [string, number][], limit = 12) => pairs.slice(0, limit).map(([k, n]) => `${k} ×${n}`).join(", ") || "none";

// Dials: range, and anything out of bounds or not a number.
console.log("SIGNALS            min    mean   max    last");
const names = [...new Set(ticks.flatMap((t) => Object.keys(t.signals)))];
const bad: string[] = [];
for (const name of names) {
  const values = ticks.map((t) => t.signals[name]?.value).filter((v): v is number => v !== undefined);
  if (values.some((v) => !Number.isFinite(v) || v < 0 || v > 1)) bad.push(name);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  console.log(`${name.padEnd(18)} ${Math.min(...values).toFixed(2).padStart(5)}  ${mean.toFixed(2).padStart(5)}  ${Math.max(...values).toFixed(2).padStart(5)}  ${values.at(-1)!.toFixed(2).padStart(5)}`);
}
console.log(bad.length ? `!! out of range or not a number: ${bad.join(", ")}` : "all signals within 0 to 1");

// Region health.
const errors = ticks.flatMap((t) => t.regions.filter((r) => r.error).map((r) => `${r.region}: ${r.error}`));
console.log(`\nREGION ERRORS: ${list(count(errors, (e) => e))}`);
const ruleErrors = ticks.flatMap((t) => t.regions.flatMap((r) => Object.entries((r.trace?.errors as Record<string, string> | undefined) ?? {}).map(([k, v]) => `${r.region}/${k}: ${v}`)));
console.log(`RULE/TRIGGER ERRORS: ${list(count(ruleErrors, (e) => e))}`);

// Behaviour.
console.log(`\nWINNERS BY REGION: ${list(count(ticks.filter((t) => t.winner), (t) => t.winner!.region))}`);
const events = ticks.flatMap((t) => t.skillEvents ?? []);
console.log(`SKILL EVENTS: ${list(count(events, (e) => `${e.skill} ${e.type}${e.type === "failed" && e.reason ? ` (${e.reason})` : ""}`), 20)}`);

// Dopamine.
type Reward = { rule: string; amount: number; raw?: number };
const rewards = ticks.flatMap((t) => (trace(t, "dopamine").rewards as Reward[] | undefined) ?? []);
const byRule = new Map<string, { n: number; total: number }>();
for (const r of rewards) byRule.set(r.rule, { n: (byRule.get(r.rule)?.n ?? 0) + 1, total: (byRule.get(r.rule)?.total ?? 0) + r.amount });
console.log(`\nREWARDS: ${[...byRule].map(([rule, { n, total }]) => `${rule} ×${n} (${total >= 0 ? "+" : ""}${total.toFixed(2)})`).join(", ") || "none"}`);
type Episode = { skill: string; situation: string; outcome: number; surprise: number; ended: string; toward?: string };
const episodes = ticks.flatMap((t) => (trace(t, "dopamine").episodes as Episode[] | undefined) ?? []);
console.log(`EPISODES: ${episodes.length}; biggest surprises: ${[...episodes].sort((a, b) => Math.abs(b.surprise) - Math.abs(a.surprise)).slice(0, 5).map((e) => `${e.skill} ${e.surprise.toFixed(2)}`).join(", ") || "none"}`);
console.log(`SITUATIONS: ${list(count(ticks, (t) => String(trace(t, "dopamine").situation ?? "?")), 6)}`);
const cues = ticks.flatMap((t) => (trace(t, "dopamine").cues as { thing: { kind: string } }[] | undefined) ?? []);
console.log(`WANTING CUES: ${list(count(cues, (c) => c.thing.kind))}`);

// Serotonin.
const inputs = (region: string, key: string) => {
  const sums = new Map<string, number[]>();
  for (const t of ticks) for (const [k, v] of Object.entries((trace(t, region)[key] as Record<string, number> | undefined) ?? {})) sums.set(k, [...(sums.get(k) ?? []), v]);
  return [...sums].map(([k, v]) => `${k} ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)}`).join(", ") || "none";
};
console.log(`\nOUTLOOK INPUTS (mean): ${inputs("serotonin", "inputs")}`);
const gaveUp = events.filter((e) => e.reason?.startsWith("gave up"));
console.log(`GAVE UP: ${gaveUp.length}${gaveUp[0] ? ` e.g. ${gaveUp[0].skill}: ${gaveUp[0].reason}` : ""}`);

// Noradrenaline.
const raised = ticks.flatMap((t) => Object.keys((trace(t, "noradrenaline").raisedBy as Record<string, number> | undefined) ?? {}));
console.log(`\nALARM RAISED BY: ${list(count(raised, (r) => r))}`);
console.log(`SEARCH INPUTS (mean): ${inputs("noradrenaline", "searchInputs")}`);
const flags = (region: string, keys: string[]) => keys.map((k) => `${k} ×${ticks.filter((t) => trace(t, region)[k] !== undefined).length}`).join(", ");
console.log(`NORADRENALINE: ${flags("noradrenaline", ["interrupt", "plannerOffline", "panicLock", "jumpy", "rethink", "goalHopping"])}`);

// Acetylcholine.
console.log(`\nFOCUS INPUTS (mean): ${inputs("acetylcholine", "inputs")}`);
type Lookup = { what: string; used: boolean };
const lookups = ticks.flatMap((t) => (trace(t, "acetylcholine").remembered as Lookup[] | undefined) ?? []);
console.log(`REMEMBERED VALUES: used ${lookups.filter((l) => l.used).length}, rejected ${lookups.filter((l) => !l.used).length}`);
console.log(`ACETYLCHOLINE: ${flags("acetylcholine", ["cue", "asleep", "warning", "attention"])}`);

// Memory.
type Recorded = { trigger: string; summary: string; strength: number; merged: boolean };
const recorded = ticks.flatMap((t) => (trace(t, "hippocampus").recorded as Recorded[] | undefined) ?? []);
console.log(`\nMEMORIES RECORDED: ${recorded.length} (${list(count(recorded, (r) => r.trigger))})`);
for (const r of recorded.slice(0, 8)) console.log(`  - ${r.summary} [${r.strength.toFixed(2)}${r.merged ? ", merged" : ""}]`);
const passes = ticks.flatMap((t) => (trace(t, "hippocampus").consolidation ? [trace(t, "hippocampus").consolidation as { phase: string; changed: number }] : []));
console.log(`CONSOLIDATION: ${passes.length} phases, ${passes.reduce((a, p) => a + p.changed, 0)} changes`);

// Planner.
const plans = ticks.flatMap((t) => t.regions.filter((r) => r.region === "prefrontal" && r.trace?.plan).map((r) => r.trace!.plan as { goal: string }));
console.log(`\nPLANS: ${plans.length}; goals: ${list(count(plans, (p) => p.goal), 5)}`);
console.log(`GOAL SET BY: ${list(count(ticks.filter((t) => t.goal), (t) => t.goal!.setBy))}`);

// Every warning anywhere.
const warnings = ticks.flatMap((t) => t.regions.flatMap((r) => [r.trace?.warning, ...((r.trace?.warnings as string[] | undefined) ?? []), r.trace?.attention].filter((w): w is string => typeof w === "string").map((w) => `${r.region}: ${w}`)));
console.log(`\nWARNINGS: ${list(count(warnings, (w) => w), 10)}`);
