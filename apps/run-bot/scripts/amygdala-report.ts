// What a tick log says of the amygdala and the hippocampus's map, for brain-report: what was
// learned and unlearned by type of cue, fears that came back, tag-alongs that were not blamed,
// hurts the amygdala had not seen coming, and how big the map is and how often it was used.

interface Change {
  cue: string;
  what: "harm" | "good" | "safe";
  from: number;
  to: number;
}
interface Learned {
  after: string;
  sign?: "harm" | "good";
  size?: number;
  predicted?: number;
  rated?: number;
  spared?: number;
  changes: Change[];
}
interface Trace {
  learned?: Learned[];
  returned?: { cue: string; from: number; to: number; why: string }[];
  worstMs?: number;
  slow?: string;
}
interface MapTrace {
  place?: { cells: number; worstMs: number; used?: Record<string, number> };
  replays?: { sign: string; cells: unknown[] }[];
  consolidation?: { phase: string; changed: number };
}
export interface ReportTick {
  timestamp: number;
  regions: { region: string; trace?: Record<string, unknown> }[];
}

/** Something rated below this was taken for harmless. */
const KNOWN_HARM = 0.12;
const typeOf = (cue: string) => cue.slice(0, Math.max(0, cue.indexOf(":")));
const n = (x: number) => (Math.round(x * 100) / 100).toString();
const traceOf = <T>(t: ReportTick, region: string) => (t.regions.find((r) => r.region === region)?.trace ?? {}) as T;

export function amygdalaReport(ticks: ReportTick[]): string[] {
  const start = ticks[0]?.timestamp ?? 0;
  const when = (t: ReportTick) => `${Math.round((t.timestamp - start) / 1000)} s in`;
  const traces = ticks.map((t) => ({ t, a: traceOf<Trace>(t, "amygdala"), h: traceOf<MapTrace>(t, "hippocampus") }));
  if (!traces.some(({ a }) => a.worstMs !== undefined)) return ["AMYGDALA: not in this run"];
  const learned = traces.flatMap(({ t, a }) => (a.learned ?? []).map((l) => ({ t, l })));
  const changes = learned.flatMap(({ l }) => l.changes);

  // Learned and unlearned, by type of cue: how many changes, and how far they moved in all.
  const byType = new Map<string, { harm: number; safer: number; good: number; n: number }>();
  for (const c of changes) {
    const row = byType.get(typeOf(c.cue)) ?? { harm: 0, safer: 0, good: 0, n: 0 };
    const moved = c.to - c.from;
    if (c.what === "harm") row.harm += moved;
    if (c.what === "safe") row.safer += moved;
    if (c.what === "good") row.good += moved;
    row.n++;
    byType.set(typeOf(c.cue), row);
  }
  const lines = [`AMYGDALA: ${learned.filter(({ l }) => l.sign === "harm").length} harm outcome(s), ${learned.filter(({ l }) => l.sign === "good").length} good, ${learned.filter(({ l }) => !l.sign).length} harmless meeting(s) learned from`];
  for (const [type, row] of byType) lines.push(`  ${type}: ${row.n} change(s); harm ${row.harm >= 0 ? "+" : ""}${n(row.harm)}, made safer here ${row.safer >= 0 ? "+" : ""}${n(row.safer)}, good ${row.good >= 0 ? "+" : ""}${n(row.good)}`);

  const returned = traces.flatMap(({ t, a }) => (a.returned ?? []).map((r) => `${r.cue} ${n(r.from)} to ${n(r.to)}: ${r.why} (${when(t)})`));
  lines.push(`FEARS THAT CAME BACK: ${returned.length}${returned.length ? `\n  - ${returned.slice(0, 10).join("\n  - ")}` : ""}`);

  const harms = learned.filter(({ l }) => l.sign === "harm");
  const spared = harms.reduce((sum, { l }) => sum + (l.spared ?? 0), 0);
  lines.push(`TAG-ALONGS NOT BLAMED: ${spared} cue(s) over ${harms.length} harm outcome(s) were around and learned nothing from it`);

  // Hurt by something rated harmless: what the outcome pointed at (or, pointing at nothing, everything around) predicted too little.
  const unforeseen = harms.filter(({ l }) => (l.rated ?? l.predicted ?? 0) < KNOWN_HARM).map(({ t, l }) => `${l.after}: rated ${n(l.rated ?? l.predicted ?? 0)} (${when(t)})`);
  lines.push(`HURT BY SOMETHING RATED HARMLESS: ${unforeseen.length}${unforeseen.length ? `\n  - ${unforeseen.slice(0, 12).join("\n  - ")}` : ""}`);

  const worst = Math.max(0, ...traces.map(({ a }) => a.worstMs ?? 0));
  lines.push(`SLOWEST AMYGDALA TICK: ${n(worst)} ms${worst > 1 ? ` (!! over the 1 ms limit on ${traces.filter(({ a }) => a.slow).length} ticks)` : ""}`);

  const place = traces.map(({ h }) => h.place).filter((p) => p !== undefined);
  if (place.length) {
    const used = place.at(-1)!.used ?? {};
    const back = traces.flatMap(({ h }) => h.replays ?? []);
    const atRest = traces.filter(({ h }) => h.consolidation?.phase === "replay");
    lines.push(`MAP: ${place.at(-1)!.cells} cell(s) (${place.at(-1)!.cells - place[0]!.cells} new this run); used: ${Object.entries(used).map(([what, times]) => `${what} ×${times}`).join(", ") || "not yet"}; slowest tick ${n(Math.max(...place.map((p) => p.worstMs)))} ms`);
    lines.push(`REPLAYS: ${back.length} backward after an outcome (${back.filter((r) => r.sign === "good").length} good, ${back.filter((r) => r.sign === "harm").length} harm), ${atRest.length} at rest (${atRest.reduce((sum, { h }) => sum + (h.consolidation?.changed ?? 0), 0)} ways gone over)`);
  }
  return lines;
}
