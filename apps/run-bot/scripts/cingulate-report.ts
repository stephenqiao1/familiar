// The cingulate's part of the brain report, from a tick log. While it is in shadow this is the
// comparison of what it would do with what happens today: planner wakes, events that tripped
// more than one alarm, verdicts over time, `leave` beside the give-up clock, and `changeable`.
//   pnpm brain-report logs/player-....jsonl     (the CINGULATE section)
export interface CingulateTick {
  timestamp: number;
  regions: { region: string; trace?: Record<string, unknown> }[];
  skillEvents?: { skill: string; type: string; reason?: string }[];
}
interface Event {
  kinds: string[];
  about: string[];
  strength: number;
  age: number;
}
interface Trace {
  trouble?: { level: number; events: Event[] };
  stake?: number;
  chance?: number;
  cost?: number;
  control?: number;
  verdict?: string;
  why?: string;
  calls?: number;
  leave?: { level: number; current: number; background: number };
  changeable?: { level: number; recent: number; usual: number };
  /** While looking inward: when the spell began. */
  inward?: { since: number };
  would?: { wakePlanner: boolean; hurryDeciders: boolean; giveUp: boolean };
  today?: { plannerWoken: boolean; decidersHurried: boolean };
  /** What each reader took this tick (a reader at strength 0 is left out). */
  readBy?: { planner?: string; gate?: string; view?: number; focus?: number; alarm?: number; patience?: number; habit?: string; learning?: number };
}

const traceOf = (t: CingulateTick) => (t.regions.find((r) => r.region === "cingulate")?.trace ?? null) as Trace | null;
const count = <T>(items: T[], by: (item: T) => string) => [...items.reduce((m, i) => m.set(by(i), (m.get(by(i)) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
const list = (counts: [string, number][], most = 8) => counts.slice(0, most).map(([k, n]) => `${k} ×${n}`).join(", ") || "none";
/** How often something went from off to on. */
const rises = (flags: boolean[]) => flags.filter((on, i) => on && !flags[i - 1]).length;
const BIN_MS = 300_000;

/** Every event the cingulate gathered, once each, with all the faces it came to have. */
export function eventsOf(ticks: CingulateTick[]): { at: number; kinds: string[]; about: string[]; strength: number }[] {
  const seen = new Map<string, { at: number; kinds: Set<string>; about: Set<string>; strength: number }>();
  for (const t of ticks) {
    for (const e of traceOf(t)?.trouble?.events ?? []) {
      // An event is named by when it began (to the tick) and its first face.
      const key = `${Math.round((t.timestamp - e.age) / 100)} ${e.kinds[0]}`;
      const had = seen.get(key) ?? { at: t.timestamp - e.age, kinds: new Set<string>(), about: new Set<string>(), strength: 0 };
      for (const kind of e.kinds) had.kinds.add(kind);
      for (const a of e.about) had.about.add(a);
      had.strength = Math.max(had.strength, e.strength);
      seen.set(key, had);
    }
  }
  return [...seen.values()].map((e) => ({ at: e.at, kinds: [...e.kinds], about: [...e.about], strength: e.strength }));
}

/** One line for each five minutes: how the ticks split between the verdicts, and the most `changeable` and `leave` reached. */
export function overTime(ticks: CingulateTick[]): string[] {
  const start = ticks[0]?.timestamp ?? 0;
  const bins = new Map<number, Trace[]>();
  for (const t of ticks) {
    const trace = traceOf(t);
    if (trace?.verdict) bins.set(Math.floor((t.timestamp - start) / BIN_MS), [...(bins.get(Math.floor((t.timestamp - start) / BIN_MS)) ?? []), trace]);
  }
  return [...bins].sort((a, b) => a[0] - b[0]).map(([bin, traces]) => {
    const share = (verdict: string) => `${Math.round((100 * traces.filter((t) => t.verdict === verdict).length) / traces.length)}%`;
    const most = (read: (t: Trace) => number) => Math.max(0, ...traces.map(read)).toFixed(2);
    const rates = traces.flatMap((t) => (t.readBy?.learning === undefined ? [] : [t.readBy.learning]));
    const learning = rates.length ? `; learning rates ×${(rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(2)} on average (×${Math.min(...rates).toFixed(2)} to ×${Math.max(...rates).toFixed(2)})` : "";
    return `    ${String(bin * 5).padStart(3)} to ${String(bin * 5 + 5).padEnd(3)} min: try harder ${share("try harder")}, carry on ${share("carry on")}, leave it ${share("leave it")}; most trouble ${most((t) => t.trouble?.level ?? 0)}, control ${most((t) => t.control ?? 0)}, leave ${most((t) => t.leave?.level ?? 0)}, changeable ${most((t) => t.changeable?.level ?? 0)}${learning}`;
  });
}

export function cingulateReport(ticks: CingulateTick[]): string[] {
  const traces = ticks.flatMap((t) => ((trace) => (trace?.verdict ? [trace] : []))(traceOf(t)));
  if (!traces.length) return ["  no cingulate in this run (or its gathering is off)"];
  const events = eventsOf(ticks);
  const several = events.filter((e) => e.kinds.length > 1);
  const plans = ticks.flatMap((t) => t.regions.filter((r) => r.region === "prefrontal" && r.trace?.plan).map((r) => r.trace as { woken?: string }));
  const wokenToday = plans.filter((p) => p.woken);
  // The reason the planner was given: with the cingulate read, the trouble in its own words.
  const reasons = count(wokenToday, (p) => /^There is trouble: ([^.]*)\./.exec(p.woken!)?.[1] ?? (p.woken!.includes("is stuck") ? "a stuck step (the old rule)" : "a surprise (the old rule)"));
  const minutes = Math.max(1 / 60, ((ticks.at(-1)?.timestamp ?? 0) - (ticks[0]?.timestamp ?? 0)) / 60_000);
  const jev = ticks.filter((t) => t.regions.some((r) => r.region === "instinct" && r.trace?.answers)).length;
  const read = traces.flatMap((t) => (t.readBy ? [t.readBy] : []));
  const top = (of: (r: NonNullable<Trace["readBy"]>) => number | undefined) => Math.max(0, ...read.map((r) => of(r) ?? 0)).toFixed(2);
  const rates = read.flatMap((r) => (r.learning === undefined ? [] : [r.learning]));
  const gaveUp = ticks.flatMap((t) => (t.skillEvents ?? []).filter((e) => e.type === "failed" && (e.reason ?? "").startsWith("gave up")).map((e) => ({ at: t.timestamp, skill: e.skill, cause: /\(([^)]*)\)\s*$/.exec(e.reason ?? "")?.[1] ?? "the clock" })));
  // `leave` in the half minute before each time the clock gave up.
  const before = gaveUp.map((g) => Math.max(0, ...ticks.filter((t) => t.timestamp <= g.at && g.at - t.timestamp <= 30_000).map((t) => traceOf(t)?.leave?.level ?? 0)));
  // Looking inward: the spells, how long each lasted, and the planner's reviews with what each did to the notes.
  const spells = new Map<number, number>();
  for (const t of traces) if (t.inward) spells.set(t.inward.since, (spells.get(t.inward.since) ?? 0) + 1);
  const tickMs = ((ticks.at(-1)?.timestamp ?? 0) - (ticks[0]?.timestamp ?? 0)) / Math.max(1, ticks.length - 1);
  const reviews = ticks.flatMap((t) => t.regions.filter((r) => r.region === "prefrontal" && r.trace?.review).map((r) => (r.trace!.review as { notes: Record<string, string[]> }).notes));
  const changed = (notes: Record<string, string[]>) => Object.entries(notes).filter(([k, v]) => k !== "now" && k !== "kept" && v.length).map(([k, v]) => `${k} ${v.join(", ")}`).join("; ") || "nothing changed";
  const sorted = ticks.filter((t) => t.regions.some((r) => r.region === "hippocampus" && r.trace?.consolidation)).length;
  const spentVerdicts = traces.filter((t) => t.why === "the call budget is spent").length;
  return [
    `  trouble: up on ${traces.filter((t) => (t.trouble?.level ?? 0) > 0).length} of ${traces.length} ticks; ${events.length} events, by kind: ${list(count(events.flatMap((e) => e.kinds), (k) => k))}`,
    `  events with more than one face (counted once): ${several.length}${several.length ? `: ${list(count(several, (e) => e.kinds.join(" + ")), 5)}` : ""}`,
    `  verdicts (ticks): ${list(count(traces, (t) => t.verdict!))}; carry on because the budget was spent: ${spentVerdicts}; calls in the minute before, at most ${Math.max(0, ...traces.map((t) => t.calls ?? 0))}`,
    `  the planner today: ${plans.length} plans, ${wokenToday.length} woken at once (${list(reasons)}); its gate was lifted ${rises(traces.map((t) => t.today?.plannerWoken ?? false))} times. The cingulate would wake it ${traces.filter((t) => t.would?.wakePlanner).length} times`,
    `  the deciders today: hurried on ${traces.filter((t) => t.today?.decidersHurried).length} ticks. The cingulate would hurry them on ${traces.filter((t) => t.would?.hurryDeciders).length}`,
    `  giving up: the clock gave up ${gaveUp.length} times (${list(count(gaveUp, (g) => g.skill))}); \`leave\` in the half minute before each: ${before.map((l) => l.toFixed(2)).join(", ") || "none"}. \`leave\` rose ${rises(traces.map((t) => (t.leave?.level ?? 0) >= 0.5))} times to 0.5 or more; the cingulate would give up on ${rises(traces.map((t) => t.would?.giveUp ?? false))} occasions`,
    `  changeable: above 0 on ${traces.filter((t) => (t.changeable?.level ?? 0) > 0).length} ticks, at most ${Math.max(0, ...traces.map((t) => t.changeable?.level ?? 0)).toFixed(2)}`,
    `  giving up, by cause: ${list(count(gaveUp, (g) => g.cause))}`,
    `  the planner's wakes, by the reason it was given: ${list(reasons, 12)}`,
    `  calls: planner ${plans.length} (${(plans.length / minutes).toFixed(1)} a minute), Jev ${jev} (${(jev / minutes).toFixed(1)} a minute), over ${minutes.toFixed(0)} minutes`,
    read.length
      ? `  who read it (${read.length} ticks): planner woken on ${rises(read.map((r) => r.planner === "woken"))} occasions; deciders hurried on ${read.filter((r) => r.gate === "hurried").length} ticks; instinct's view up to ×${top((r) => r.view)}; focus input up to ${top((r) => r.focus)}; alarm entry up to ${top((r) => r.alarm)}; give-up clock read \`leave\` up to ${top((r) => r.patience)}; habits gave way on ${read.filter((r) => r.habit === "gives way").length} ticks; learning rates ×${rates.length ? `${Math.min(...rates).toFixed(2)} to ×${Math.max(...rates).toFixed(2)}` : "1 (not read)"}`
      : "  who read it: nobody (every reader is at 0: shadow)",
    `  inward: ${spells.size} spells (${[...spells.values()].map((n) => `${Math.round((n * tickMs) / 1000)} s`).join(", ") || "none"}); memories sorted on ${sorted} ticks; ${reviews.length} reviews${reviews.length ? `: ${reviews.map(changed).join(" | ")}` : ""}`,
    "  over time:",
    ...overTime(ticks),
  ];
}
