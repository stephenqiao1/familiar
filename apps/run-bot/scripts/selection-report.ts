// The basal ganglia's part of the brain report: who won and why, from each tick's `selection`.

interface Who { region: string; layer: number; skill?: string; urgency: number; won?: boolean }
interface Conflict { channel: string; between: Who[]; closeness: number; ms: number; state: "waiting" | "settled"; how?: string }
export interface Selection {
  urgent?: boolean;
  candidates?: Who[];
  channels?: Record<string, { winner?: Who }>;
  conflicts?: Conflict[];
  decidedBy?: string[];
  dropped?: Who[];
  promoted?: Who;
  worstMs?: number;
}
export interface SelectionTick {
  timestamp: number;
  winner: { region: string; layer?: number; action: { skill?: string } } | null;
  alongside?: { region: string; action: { skill?: string } };
  selection?: Selection;
  regions: { region: string; trace?: Record<string, unknown> }[];
}

const STRIATUM = "striatum";
/** Whether the action on a tick was the habit the striatum was acting on. */
export function byHabit(t: SelectionTick): boolean {
  const trace = t.regions.find((r) => r.region === STRIATUM)?.trace as { use?: boolean; habit?: { skill: string } } | undefined;
  return trace?.use === true && t.winner?.action.skill === trace.habit?.skill;
}
const tally = (keys: string[]) => [...keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
const list = (pairs: [string, number][]) => pairs.map(([k, n]) => `${k} ×${n}`).join(", ") || "none";
const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : "n/a");

/** What the basal ganglia did over a run, as lines to print. Empty if the log has no selection traces. */
export function selectionReport(ticks: SelectionTick[]): string[] {
  const chosen = ticks.filter((t) => t.selection);
  if (!chosen.length) return [];
  const body = (c: { region: string; layer?: number }) => c.layer === 0 && c.region !== STRIATUM;
  const wins = ticks.filter((t) => t.winner?.action.skill !== undefined);
  const layerOf = (t: SelectionTick) => (byHabit(t) ? "habit" : `layer ${t.winner!.layer ?? "?"}`);
  // The body overruled: a decider (or a habit) won the action while a request of the body for another skill was in the same contest. And the reverse.
  const over = chosen.filter((t) => !t.selection!.urgent && t.winner && !body(t.winner) && (t.selection!.candidates ?? []).some((c) => body(c) && c.skill !== t.winner!.action.skill));
  const under = chosen.filter((t) => t.winner && body(t.winner) && (t.selection!.candidates ?? []).some((c) => !body(c) && c.skill !== t.winner!.action.skill && c.urgency > ((t.selection!.candidates ?? []).find((w) => w.won)?.urgency ?? 1)));
  // A near tie is one stretch of ticks in a channel; it ends settled, or by the tie going away.
  const waits: { channel: string; ms: number; how: string }[] = [];
  const open = new Map<string, { ms: number }>();
  for (const t of chosen) {
    const now = new Map((t.selection!.conflicts ?? []).map((c) => [c.channel, c]));
    for (const [channel, was] of open) {
      const c = now.get(channel);
      if (c?.state === "waiting") was.ms = c.ms;
      else {
        waits.push({ channel, ms: c ? c.ms : was.ms, how: c?.how ?? "the tie went away" });
        open.delete(channel);
      }
    }
    for (const [channel, c] of now) if (c.state === "waiting" && !open.has(channel)) open.set(channel, { ms: c.ms });
  }
  const striatum = ticks.flatMap((t) => t.regions.filter((r) => r.region === STRIATUM).map((r) => r.trace ?? {})).at(-1) as { used?: number; saved?: number; broken?: number; wrong?: number; asked?: number } | undefined;
  // A habit acted: the striatum proposed it and that action went ahead (whether its own candidate or the standing choice for the same skill carried it).
  const habitTicks = ticks.filter(byHabit).length;
  const worst = Math.max(0, ...chosen.map((t) => t.selection!.worstMs ?? 0));
  const longest = Math.max(0, ...waits.map((w) => w.ms));
  return [
    `\nBASAL GANGLIA: ${chosen.length} choices, ${chosen.filter((t) => t.selection!.urgent).length} settled outright by full urgency`,
    `  the action, by who won: ${list(tally(wins.map(layerOf)))}`,
    `  alongside (the head's own contest, or a flinch): ${list(tally(ticks.flatMap((t) => (t.alongside ? [`${t.alongside.region} ${t.alongside.action.skill ?? ""}`.trim()] : []))))}`,
    `  a decider went ahead over a request of the body: ${over.length} ticks; the body went ahead over a more urgent decider: ${under.length} ticks`,
    `  near ties: ${waits.length} (${list(tally(waits.map((w) => w.how)))}); ${chosen.filter((t) => (t.selection!.conflicts ?? []).some((c) => c.state === "waiting")).length} ticks spent waiting, the longest wait ${longest} ms${longest > 300 + 150 ? " (!! well over 300 ms)" : ""}`,
    `  whole-body skills that won one channel and lost another: ${chosen.filter((t) => t.selection!.dropped?.length).length} ticks; a look that took over the body: ${chosen.filter((t) => t.selection!.promoted).length} ticks`,
    `  habits: the action came from a habit on ${habitTicks} of ${ticks.length} ticks (${pct(habitTicks, ticks.length)})${striatum?.used === undefined ? "" : `; Jev calls saved ${striatum.saved ?? 0}, asked ${striatum.asked ?? 0} times, wrong habits ${striatum.wrong ?? 0}, broken ${striatum.broken ?? 0}`}`,
    `  terms that changed who won: ${list(tally(chosen.flatMap((t) => t.selection!.decidedBy ?? [])))}`,
    `  SLOWEST CHOICE: ${worst.toFixed(3)} ms${worst > 1 ? " (!! over the 1 ms limit)" : ""}`,
  ];
}
