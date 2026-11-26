// The shadow report: sums up, from a tick log, how the amygdala's reading compared with today's
// learning rules while it only watched. Today's rules: the threat record (danger by kind),
// hurts.json (hurtful blocks), bad-foods.json (bad foods) and the feeling of a place from memory.
//   pnpm shadow-report logs/player-....jsonl
import { readFileSync } from "node:fs";

type Row = [sort: string, cue: string, old: number, amygdala: number];
interface Change {
  cue: string;
  what: "harm" | "good" | "safe";
  from: number;
  to: number;
}
interface Trace {
  fear?: number;
  appeal?: number;
  shadow?: Row[];
  begun?: { cue: string; harm: number; like?: string; born?: boolean }[];
  learned?: { after: string; sign?: string; size?: number; predicted?: number; changes: Change[] }[];
  worstMs?: number;
  slow?: string;
}
export interface ShadowTick {
  timestamp: number;
  regions: { region: string; trace?: Record<string, unknown> }[];
}

/** A kind's danger agrees within this; a yes-or-no rule agrees when the amygdala is on the same side of FEARED. */
const CLOSE = 0.2;
const FEARED = 0.3;
const OLD_SOURCE: Record<string, string> = { kind: "threat record", block: "hurts.json", food: "bad-foods.json", place: "feeling from memory" };
const n = (x: number) => (Math.round(x * 100) / 100).toString();
const pad = (s: string, w: number) => (s.length >= w ? s : s + " ".repeat(w - s.length));
const agrees = ([sort, , old, now]: Row) => (sort === "kind" ? Math.abs(old - now) <= CLOSE : old >= 0.5 === now >= FEARED);

interface Seen {
  sort: string;
  ticks: number;
  agreed: number;
  old: { first: number; last: number; min: number; max: number };
  now: { first: number; last: number; min: number; max: number };
  /** What the amygdala did with it. */
  hurts: string[];
  harmless: number;
  start: string;
}

export function shadowReport(ticks: ShadowTick[]): string[] {
  const seen = new Map<string, Seen>();
  const out: string[] = [];
  let [harms, goods, slow, worst, ran] = [0, 0, 0, 0, 0];
  const fears: number[] = [];
  const range = (r: Seen["old"], v: number) => void Object.assign(r, { last: v, min: Math.min(r.min, v), max: Math.max(r.max, v) });
  const of = (cue: string, sort: string) => {
    if (!seen.has(cue)) seen.set(cue, { sort, ticks: 0, agreed: 0, old: { first: NaN, last: 0, min: Infinity, max: -Infinity }, now: { first: NaN, last: 0, min: Infinity, max: -Infinity }, hurts: [], harmless: 0, start: "" });
    return seen.get(cue)!;
  };
  const notes = new Map<string, { hurts: string[]; harmless: number; start: string }>();
  const note = (cue: string) => notes.get(cue) ?? notes.set(cue, { hurts: [], harmless: 0, start: "" }).get(cue)!;

  for (const tick of ticks) {
    const trace = tick.regions.find((r) => r.region === "amygdala")?.trace as Trace | undefined;
    if (!trace) continue;
    ran++;
    fears.push(trace.fear ?? 0);
    worst = Math.max(worst, trace.worstMs ?? 0);
    if (trace.slow) slow++;
    for (const b of trace.begun ?? []) note(b.cue).start = b.like ? `began at ${n(b.harm)}, like ${b.like}` : `born at ${n(b.harm)}`;
    for (const l of trace.learned ?? []) {
      if (l.sign === "harm") harms++;
      if (l.sign === "good") goods++;
      for (const c of l.changes) {
        if (c.what === "harm" && c.to > c.from) note(c.cue).hurts.push(`${l.after}: ${n(c.from)} to ${n(c.to)}`);
        if (c.what === "safe" && c.to > c.from) note(c.cue).harmless++;
      }
    }
    for (const row of trace.shadow ?? []) {
      const s = of(row[1], row[0]);
      s.ticks++;
      if (agrees(row)) s.agreed++;
      if (Number.isNaN(s.old.first)) [s.old.first, s.now.first] = [row[2], row[3]];
      range(s.old, row[2]);
      range(s.now, row[3]);
    }
  }
  for (const [cue, s] of seen) Object.assign(s, notes.get(cue) ?? {});

  const minutes = ticks.length ? (ticks.at(-1)!.timestamp - ticks[0]!.timestamp) / 60_000 : 0;
  const sorted = [...fears].sort((a, b) => a - b);
  out.push(`${ran} ticks over ${n(minutes)} minutes. Harm outcomes: ${harms}. Good outcomes: ${goods}. Fear: middle ${n(sorted[Math.floor(sorted.length / 2)] ?? 0)}, highest ${n(sorted.at(-1) ?? 0)}. Amygdala worst tick ${n(worst)} ms, ${slow} over 1 ms.`, "");

  out.push("By what is compared:", `${pad("what", 8)}${pad("today's rule", 22)}${pad("cues", 6)}${pad("ticks", 8)}${pad("agree", 8)}differ`);
  for (const sort of Object.keys(OLD_SOURCE)) {
    const of = [...seen.values()].filter((s) => s.sort === sort);
    const [total, agreed] = [of.reduce((a, s) => a + s.ticks, 0), of.reduce((a, s) => a + s.agreed, 0)];
    out.push(`${pad(sort, 8)}${pad(OLD_SOURCE[sort]!, 22)}${pad(String(of.length), 6)}${pad(String(total), 8)}${pad(total ? `${Math.round((100 * agreed) / total)}%` : "-", 8)}${total - agreed}`);
  }

  const why = (s: Seen): string => {
    const parts = [s.start, s.hurts.length ? `raised ${s.hurts.length} time(s) (${s.hurts.slice(-2).join("; ")})` : "", s.harmless ? `made safer here by ${s.harmless} harmless meeting(s)` : ""].filter(Boolean);
    if (s.sort === "kind" && s.old.max === 0 && s.now.max > CLOSE) parts.push("today's rule does not hold it a threat");
    if (s.sort !== "kind" && s.old.max >= 0.5 && s.now.max < FEARED) parts.push(s.hurts.length ? "today's rule counts incidents; the amygdala grades by size and share" : "the amygdala saw no harm follow it");
    return parts.join("; ") || "no evidence either way";
  };
  const line = (cue: string, s: Seen) => `${pad(cue, 30)}${pad(`${n(s.old.first)} to ${n(s.old.last)}`, 16)}${pad(`${n(s.now.first)} to ${n(s.now.last)} (${n(s.now.min)}..${n(s.now.max)})`, 30)}${pad(`${s.ticks - s.agreed}/${s.ticks}`, 12)}${why(s)}`;
  const head = `${pad("cue", 30)}${pad("today's rule", 16)}${pad("amygdala (range)", 30)}${pad("differed", 12)}why`;
  const differed = [...seen].filter(([, s]) => s.agreed < s.ticks).sort((a, b) => b[1].ticks - b[1].agreed - (a[1].ticks - a[1].agreed));
  out.push("", `Cues that differed at any time (${differed.length} of ${seen.size}):`, head, ...differed.map(([cue, s]) => line(cue, s)));

  // Learned by one and not the other: a rule's answer moved, and the other's did not move the same way.
  const moved = (r: Seen["old"]) => (r.max - r.first >= 0.05 ? "up" : r.first - r.min >= 0.05 ? "down" : "");
  const oldOnly = [...seen].filter(([, s]) => moved(s.old) && moved(s.now) !== moved(s.old));
  const newOnly = [...seen].filter(([, s]) => moved(s.now) && moved(s.old) !== moved(s.now));
  out.push("", `Today's rule learned, the amygdala did not (${oldOnly.length}):`, ...(oldOnly.length ? [head, ...oldOnly.map(([cue, s]) => line(cue, s))] : ["  none"]));
  out.push("", `The amygdala learned, today's rule did not (${newOnly.length}):`, ...(newOnly.length ? [head, ...newOnly.map(([cue, s]) => line(cue, s))] : ["  none"]));

  // What the amygdala learned about cues today's rules have no place for.
  const others = [...notes].filter(([cue, v]) => !seen.has(cue) && (v.hurts.length || v.harmless)).map(([cue, v]) => `  ${pad(cue, 30)}${[v.start, v.hurts.length ? `raised ${v.hurts.length} time(s) (${v.hurts.slice(-1)[0]})` : "", v.harmless ? `${v.harmless} harmless meeting(s)` : ""].filter(Boolean).join("; ")}`);
  out.push("", `Cues only the amygdala keeps (areas apart from the bad-place check, times of day, sounds, signs): ${others.length}`, ...others);
  return out;
}

if (process.argv[1]?.endsWith("shadow-report.ts")) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error("Use: pnpm shadow-report logs/<log>.jsonl");
    process.exit(1);
  }
  for (const file of files) {
    const ticks = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as ShadowTick).filter((t) => t.regions);
    console.log(shadowReport(ticks).join("\n"));
  }
}
