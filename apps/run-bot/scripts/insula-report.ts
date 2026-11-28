// The insula's part of the brain report, from a tick log: how long the bot spent in each
// feeling, comfort and mood, when it was uneasy and about what, and the feeling line over time.
//   pnpm brain-report logs/player-....jsonl     (the INSULA section)
export interface InsulaTick {
  timestamp: number;
  regions: { region: string; trace?: Record<string, unknown> }[];
}
interface Felt {
  word: string;
  strength: number;
  from: string;
}
interface InsulaTrace {
  feelings?: Felt[];
  comfort?: number;
  mood?: number;
  uneasy?: { level: number; about: string[] };
  line?: string;
}

const traceOf = (t: InsulaTick) => (t.regions.find((r) => r.region === "insula")?.trace ?? null) as InsulaTrace | null;
const sec = (ms: number) => `${Math.round(ms / 1000)} s`;

/** Each change of the feeling line: when (ms from the start) and what it became. */
export function lineOverTime(ticks: InsulaTick[]): { at: number; line: string }[] {
  const out: { at: number; line: string }[] = [];
  for (const t of ticks) {
    const line = traceOf(t)?.line;
    if (line !== undefined && line !== out.at(-1)?.line) out.push({ at: t.timestamp - ticks[0]!.timestamp, line });
  }
  return out;
}

/** How long each feeling (and "at ease", and unease) was present, in ms, longest first. */
export function timeInFeelings(ticks: InsulaTick[]): [string, number][] {
  const spent = new Map<string, number>();
  ticks.forEach((t, i) => {
    const trace = traceOf(t);
    const next = ticks[i + 1];
    if (!trace?.feelings || !next) return;
    const words = trace.feelings.length ? trace.feelings.map((f) => f.word) : ["at ease"];
    for (const word of [...words, ...(trace.uneasy ? ["uneasy"] : [])]) spent.set(word, (spent.get(word) ?? 0) + (next.timestamp - t.timestamp));
  });
  return [...spent].sort((a, b) => b[1] - a[1]);
}

export function insulaReport(ticks: InsulaTick[]): string[] {
  const traces = ticks.flatMap((t) => ((trace) => (trace?.line === undefined ? [] : [trace]))(traceOf(t)));
  if (!traces.length) return ["  no insula in this run (or its feeling is off)"];
  const range = (values: number[]) => `${Math.min(...values).toFixed(2)} to ${Math.max(...values).toFixed(2)}`;
  const uneasy = traces.flatMap((t) => (t.uneasy ? t.uneasy.about : []));
  const about = [...uneasy.reduce((m, name) => m.set(name, (m.get(name) ?? 0) + 1), new Map<string, number>())].map(([name, n]) => `${name} ×${n}`).join(", ");
  const changes = lineOverTime(ticks);
  return [
    `  time in each feeling: ${timeInFeelings(ticks).map(([word, ms]) => `${word} ${sec(ms)}`).join(", ") || "none"}`,
    `  comfort ${range(traces.map((t) => t.comfort ?? 1))}; mood ${range(traces.map((t) => t.mood ?? 0))}`,
    `  uneasy on ${traces.filter((t) => t.uneasy).length} ticks${about ? ` (about ${about})` : ""}`,
    `  the feeling line changed ${Math.max(0, changes.length - 1)} times; first "${changes[0]?.line ?? ""}", last "${changes.at(-1)?.line ?? ""}"`,
  ];
}
