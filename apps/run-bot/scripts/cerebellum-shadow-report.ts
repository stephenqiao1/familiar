// The cerebellum's shadow report: from a tick log, what it predicted for each movement beside
// what the bot goes by today (the journey's estimate and `late`, the written expectations, the
// 2-minute give-up clock), while it only watched.
// With the readers on it also says what read it, and with the saved models, what each movement does.
//   pnpm cerebellum-report logs/player-....jsonl [data/<bot>/models.json]
import { readFileSync } from "node:fs";
import { movementTable, readersReport } from "./cerebellum-readers-report.ts";

interface Measure {
  measure: string;
  predicted: number | null;
  spread: number | null;
  from: string | null;
  actual: number;
  error: number | null;
}
interface Run {
  movement: string;
  key: string;
  cutShort?: boolean;
  measures: Measure[];
  changes?: string[];
  expected?: string[];
  missing?: string[];
  today?: { seconds?: number; expects?: string[]; asExpected?: boolean; secondsPerBlock?: number; estimateSeconds?: number; late?: boolean; giveUpSeconds?: number; status?: string };
}
export interface CerebellumTick {
  timestamp: number;
  regions: { region: string; trace?: Record<string, unknown> }[];
}

const n = (x: number, digits = 2) => (Number.isFinite(x) ? x.toFixed(digits) : "?");
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const table = (rows: string[][]) => {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  return rows.map((r) => `  ${r.map((cell, i) => cell.padEnd(widths[i]!)).join("  ")}`.trimEnd());
};
const group = <T>(items: T[], by: (item: T) => string) => {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(by(item), [...(groups.get(by(item)) ?? []), item]);
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
};
const of = (run: Run, measure: string) => run.measures.find((m) => m.measure === measure);
/** How often each change followed, over these runs. */
const shares = (runs: Run[]) => {
  const counts = new Map<string, number>();
  for (const run of runs) for (const change of run.changes ?? []) counts.set(change, (counts.get(change) ?? 0) + 1);
  return [...counts.entries()].map(([change, count]) => ({ change, share: count / runs.length })).sort((a, b) => b.share - a.share);
};
/** A written expectation in the words the changes are listed in. */
const written = (entry: string) => (entry === "targetHurt" || !entry.includes("=") ? entry : entry);

export function cerebellumReport(ticks: CerebellumTick[]): string[] {
  const traces = ticks.map((t) => t.regions.find((r) => r.region === "cerebellum")?.trace as { runs?: Run[]; worstMs?: number; slowMs?: number; models?: number } | undefined).filter((t) => t !== undefined);
  const all = traces.flatMap((t) => t.runs ?? []);
  const runs = all.filter((r) => !r.cutShort);
  const minutes = ticks.length ? (ticks.at(-1)!.timestamp - ticks[0]!.timestamp) / 60_000 : 0;
  const lines = [
    `${ticks.length} ticks over ${n(minutes)} minutes. Movements noted: ${all.length} (${all.length - runs.length} cut short, which taught nothing). Models: ${Math.max(0, ...traces.map((t) => t.models ?? 0))}. Cerebellum worst tick ${n(Math.max(0, ...traces.map((t) => t.worstMs ?? 0)))} ms; ticks over 1 ms: ${traces.filter((t) => t.slowMs !== undefined).length}.`,
    "",
    `Movements by kind: ${group(all, (r) => r.movement).map(([m, rs]) => `${m} ${rs.length}`).join(", ") || "none"}`,
  ];

  // 1. Pace: today's fixed speed for the gait against what was learned, by ground.
  const paces = runs.filter((r) => r.movement.startsWith("pace:") && of(r, "secondsPerBlock"));
  lines.push("", "1. Pace by ground (seconds per block). Today's estimate is the gait's fixed speed; the learned one is what the model said before each stretch.");
  if (!paces.length) lines.push("  no stretch long enough was walked");
  else {
    const rows = group(paces, (r) => `${r.movement.slice(5)} ${r.key}`).map(([key, rs]) => {
      const actual = rs.map((r) => of(r, "secondsPerBlock")!.actual);
      const today = rs.map((r) => Math.abs((r.today?.secondsPerBlock ?? NaN) - of(r, "secondsPerBlock")!.actual));
      const learned = rs.filter((r) => of(r, "secondsPerBlock")!.error !== null).map((r) => Math.abs(of(r, "secondsPerBlock")!.error!));
      return [key, String(rs.length), n(rs[0]!.today?.secondsPerBlock ?? NaN), n(mean(actual)), n(mean(today)), learned.length ? `${n(mean(learned))} (${learned.length})` : "not yet trusted"];
    });
    lines.push(...table([["pattern and ground", "stretches", "today says", "actual", "today off by", "learned off by (stretches)"], ...rows]));
  }

  // 1b. Whole journeys: today's estimate and `late`.
  const journeys = runs.filter((r) => r.movement.startsWith("journey:"));
  const estimated = journeys.filter((r) => r.today?.estimateSeconds !== undefined && r.today.seconds !== undefined);
  lines.push("", `Journeys that ended by themselves: ${journeys.length}; with an estimate today: ${estimated.length}; called late today: ${journeys.filter((r) => r.today?.late).length}.`);
  if (estimated.length) lines.push(...table([["journey", "ground", "fixed estimate", "took"], ...estimated.slice(0, 20).map((r) => [r.movement.slice(8), r.key, `${n(r.today!.estimateSeconds!, 1)} s`, `${n(r.today!.seconds!, 1)} s`])]));

  // 2 and 3. What each primitive did, against its written expectations.
  const prims = group(runs.filter((r) => r.movement.startsWith("primitive:")), (r) => r.movement.slice(10));
  const disagree: string[][] = [];
  const empty: string[][] = [];
  for (const [name, rs] of prims) {
    const expects = (rs.find((r) => r.today?.expects)?.today?.expects ?? []).map(written);
    const did = shares(rs);
    const learned = did.filter((d) => d.share >= 0.9).map((d) => d.change);
    if (rs.length < 5) (expects.length ? disagree : empty).push(expects.length ? [name, String(rs.length), expects.join(", "), "too few runs"] : [name, String(rs.length), `too few runs (so far: ${did.slice(0, 4).map((d) => `${d.change} ${Math.round(d.share * 100)}%`).join(", ") || "nothing changed"})`]);
    else if (!expects.length) empty.push([name, String(rs.length), did.slice(0, 6).map((d) => `${d.change} ${Math.round(d.share * 100)}%`).join(", ") || "nothing changed"]);
    else {
      const notMet = expects.filter((e) => !learned.includes(e)).map((e) => `${e} followed only ${Math.round((did.find((d) => d.change === e)?.share ?? 0) * 100)}%`);
      const more = learned.filter((c) => !expects.includes(c) && !expects.some((e) => e.startsWith(`${c}=`)));
      if (notMet.length || more.length) disagree.push([name, String(rs.length), expects.join(", "), [...notMet, ...(more.length ? [`also always: ${more.join(", ")}`] : [])].join("; ")]);
      else disagree.push([name, String(rs.length), expects.join(", "), "agrees"]);
    }
  }
  lines.push("", "2. Written expectations against what followed (finished and failed runs; under 5 runs is too few to trust):");
  lines.push(...(disagree.length ? table([["primitive", "runs", "written", "experience"], ...disagree]) : ["  no primitive with a written list ran"]));
  lines.push("", "3. Primitives with an empty list: what they turned out to do");
  lines.push(...(empty.length ? table([["primitive", "runs", "changes that followed"], ...empty]) : ["  none of them ran"]));
  const bySituation = group(runs.filter((r) => r.movement.startsWith("primitive:") && r.key), (r) => `${r.movement.slice(10)} @ ${r.key}`).filter(([, rs]) => rs.length >= 3).slice(0, 12);
  if (bySituation.length) lines.push("", "   By situation (3 runs or more):", ...table([["movement @ situation", "runs", "seconds", "changes"], ...bySituation.map(([key, rs]) => [key, String(rs.length), n(mean(rs.map((r) => of(r, "seconds")?.actual ?? NaN).filter(Number.isFinite))), shares(rs).slice(0, 4).map((d) => `${d.change} ${Math.round(d.share * 100)}%`).join(", ")])]));

  // 4. Each skill's usual time against the 2-minute clock.
  const skills = group(all.filter((r) => r.movement.startsWith("skill:")), (r) => r.movement.slice(6));
  lines.push("", "4. Each skill's time when it finished, against the 2-minute give-up clock:");
  lines.push(
    ...(skills.length
      ? table([
          ["skill", "ended", "finished", "cut short", "usual", "spread", "longest", "a fitted limit (usual + 3 spreads, kept in 30 to 360 s)"],
          ...skills.map(([name, rs]) => {
            const done = rs.filter((r) => !r.cutShort && of(r, "seconds")).map((r) => of(r, "seconds")!.actual);
            const usual = mean(done);
            const spread = mean(done.map((s) => Math.abs(s - usual)));
            return [name, String(rs.length), String(done.length), String(rs.filter((r) => r.cutShort).length), done.length ? `${n(usual, 1)} s` : "-", done.length ? `${n(spread, 1)} s` : "-", done.length ? `${n(Math.max(...done), 1)} s` : "-", done.length >= 5 ? `${n(Math.min(360, Math.max(30, usual + 3 * spread)), 0)} s` : "too few runs: 120 s"];
          }),
        ])
      : ["  no skill ended"]),
  );

  // The error over time, by kind of movement: it should fall. (A prediction near nothing is left out: any error is huge beside it.)
  lines.push("", "Size of the error against the prediction, trusted models only (first half of the run, then second):");
  const byKind = group(runs, (r) => r.movement.split(":")[0]!).map(([kind, rs]) => {
    const errors = rs.flatMap((r) => r.measures.filter((m) => m.error !== null && Math.abs(m.predicted ?? 0) >= 0.05).map((m) => Math.abs(m.error!) / Math.abs(m.predicted!)));
    const half = Math.floor(errors.length / 2);
    return [kind, String(errors.length), errors.length >= 8 ? `${Math.round(mean(errors.slice(0, half)) * 100)}%` : "too few", errors.length >= 8 ? `${Math.round(mean(errors.slice(half)) * 100)}%` : ""];
  });
  lines.push(...table([["kind", "predictions", "first half", "second half"], ...byKind]));
  return lines;
}

if (process.argv[1]?.endsWith("cerebellum-shadow-report.ts")) {
  const file = process.argv[2];
  if (!file) {
    console.error("Use: pnpm cerebellum-report <log file> [models.json]");
    process.exit(1);
  }
  const ticks = readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as CerebellumTick).filter((t) => t.regions);
  console.log([...cerebellumReport(ticks), "", ...readersReport(ticks), ...(process.argv[3] ? ["", ...movementTable(JSON.parse(readFileSync(process.argv[3], "utf8")))] : [])].join("\n"));
}
