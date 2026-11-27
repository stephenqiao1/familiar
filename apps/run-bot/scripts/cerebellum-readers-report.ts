// What a tick log says of the cerebellum's readers: mismatches and who read them, journeys late
// by the fixed rule and by the rule used, the give-up clock's base by skill, expectations that
// were filled in or replaced, and what was due soon. And, from the saved models, the table of
// "what my movements do".
//   pnpm cerebellum-report logs/player-....jsonl [data/<bot>/models.json]
interface Run {
  movement: string;
  key: string;
  mismatch?: number;
  missing?: string[];
  measures: { measure: string; predicted: number | null; actual: number; error: number | null }[];
  today?: { late?: boolean; expects?: string[]; used?: { late?: boolean; lateAfterSeconds?: number; estimateSeconds?: number; expects?: string[]; why?: string } };
}
interface Tick {
  timestamp: number;
  regions: { region: string; trace?: Record<string, unknown> }[];
  skillEvents?: { skill: string; type: string; reason?: string }[];
}
interface SavedModel {
  measures: Record<string, { value: number; spread: number; seen: number }>;
  runs: number;
  changes: Record<string, number>;
}

const n = (x: number, digits = 2) => (Number.isFinite(x) ? x.toFixed(digits) : "?");
const table = (rows: string[][]) => {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  return rows.map((r) => `  ${r.map((cell, i) => cell.padEnd(widths[i]!)).join("  ")}`.trimEnd());
};
const count = <T>(items: T[], by: (item: T) => string) => {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(by(item), (counts.get(by(item)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
};
const traceOf = <T>(t: Tick, region: string) => (t.regions.find((r) => r.region === region)?.trace ?? {}) as T;

export function readersReport(ticks: Tick[]): string[] {
  const own = ticks.map((t) => traceOf<{ runs?: Run[]; mismatch?: number; behind?: number; due?: { sign: string; what: string }[] }>(t, "cerebellum"));
  const runs = own.flatMap((t) => t.runs ?? []);
  const lines: string[] = ["THE CEREBELLUM'S READERS"];

  // Mismatch: each movement that came out far from its prediction, and who read the signal.
  const wrong = runs.filter((r) => r.mismatch);
  const up = ticks.filter((_, i) => (own[i]!.mismatch ?? 0) > 0);
  const focusRead = ticks.filter((t) => (traceOf<{ inputs?: Record<string, number> }>(t, "acetylcholine").inputs?.mismatch ?? 0) > 0).length;
  const alarmRead = ticks.filter((t) => JSON.stringify(traceOf(t, "noradrenaline")).includes('"mismatch"')).length;
  const habitGave = ticks.filter((t) => JSON.stringify(traceOf(t, "striatum")).includes("a movement went wrong")).length;
  lines.push(`Mismatch: ${wrong.length} movements (${wrong.filter((r) => r.mismatch! >= 0.5).length} large), up on ${up.length} ticks (${own.filter((t) => t.behind).length} for a journey behind its pace). Read by: focus on ${focusRead} ticks, alarm on ${alarmRead}, a habit gave way on ${habitGave}.`);
  if (wrong.length) lines.push(...table([["movement @ situation", "times", "largest", "what was off"], ...count(wrong, (r) => `${r.movement} @ ${r.key || "any"}`).slice(0, 10).map(([key, times]) => {
    const rs = wrong.filter((r) => `${r.movement} @ ${r.key || "any"}` === key);
    const worst = rs.reduce((a, b) => (b.mismatch! > a.mismatch! ? b : a));
    const off = worst.missing?.length ? `did not follow: ${worst.missing.join(", ")}` : worst.measures.filter((m) => m.error !== null).map((m) => `${m.measure} ${n(m.actual)} against ${n(m.predicted!)}`).join(", ");
    return [key, String(times), n(worst.mismatch!), off];
  })]));

  // Late: the fixed rule against the rule used.
  const journeys = runs.filter((r) => r.movement.startsWith("journey:") && r.today?.used);
  const [old, used] = [journeys.filter((r) => r.today!.late), journeys.filter((r) => r.today!.used!.late)];
  lines.push(`Journeys with an estimate: ${journeys.length}. Late by the fixed rule: ${old.length}; by the rule used: ${used.length} (${used.filter((r) => !r.today!.late).length} only by the learned pace, ${old.filter((r) => !r.today!.used!.late).length} only by the fixed rule).`);

  // Give-ups, and the base each skill's clock started from.
  const bases = new Map<string, number>();
  for (const t of ticks) {
    const p = traceOf<{ persistence?: { skill: string; baseSeconds?: number } }>(t, "serotonin").persistence;
    if (p?.baseSeconds !== undefined) bases.set(p.skill, p.baseSeconds);
  }
  const gaveUp = ticks.flatMap((t) => t.skillEvents ?? []).filter((e) => e.reason?.startsWith("gave up"));
  lines.push(`Give-ups: ${gaveUp.length}${gaveUp.length ? ` (${count(gaveUp, (e) => e.skill).map(([s, c]) => `${s} ${c}`).join(", ")})` : ""}. The clock's base by skill (fixed: 120 s): ${[...bases].map(([skill, base]) => `${skill} ${n(base, 0)} s`).join(", ") || "no skill ran long enough to show"}.`);

  // Expectations filled in or replaced.
  const replaced = runs.filter((r) => r.today?.used?.expects);
  lines.push(`Learned expectations used: ${replaced.length} runs.`);
  if (replaced.length) lines.push(...table([["movement @ situation", "runs", "written", "used", "why"], ...count(replaced, (r) => `${r.movement} @ ${r.key || "any"}`).slice(0, 12).map(([key, times]) => {
    const r = replaced.find((x) => `${x.movement} @ ${x.key || "any"}` === key)!;
    return [key, String(times), r.today!.expects?.join(", ") || "(none)", r.today!.used!.expects!.join(", ") || "(nothing)", r.today!.used!.why ?? ""];
  })]));

  // Timing.
  const due = own.flatMap((t) => t.due ?? []);
  const timed = runs.filter((r) => r.movement.startsWith("timing:"));
  lines.push(`Timing: ${timed.length} delays learned from${timed.length ? ` (${count(timed, (r) => r.movement.slice(7)).map(([pair, c]) => `${pair} ${c}`).join(", ")})` : ""}; something was due soon on ${own.filter((t) => t.due?.length).length} ticks${due.length ? ` (${count(due, (d) => d.what).map(([what]) => what).join(", ")})` : ""}.`);
  return lines;
}

/** "What my movements do": each trusted model of a built-in movement, by situation. */
export function movementTable(models: Record<string, SavedModel>, trusted = 5): string[] {
  const rows = Object.entries(models)
    .filter(([id, m]) => id.startsWith("primitive:") && m.runs >= trusted)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, m]) => {
      const [name = "", key] = id.slice(10).split("@");
      const always = Object.entries(m.changes).filter(([, c]) => c / m.runs >= 0.9).map(([c]) => c).sort();
      const often = Object.entries(m.changes).filter(([, c]) => c / m.runs >= 0.3 && c / m.runs < 0.9).map(([c, count]) => `${c} ${Math.round((count / m.runs) * 100)}%`);
      const s = m.measures.seconds;
      return [name, key ?? "any", n(m.runs, 0), s ? `${n(s.value)} s ± ${n(s.spread)}` : "-", always.join(", ") || "nothing", often.join(", ")];
    });
  return ["WHAT MY MOVEMENTS DO (models seen 5 times or more)", ...table([["movement", "situation", "runs", "takes", "always (9 in 10)", "sometimes"], ...rows])];
}
