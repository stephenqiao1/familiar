// The cortex's part of the brain report, from a tick log: the steps the motor area finished and
// how long after their condition came true (the condition is checked again here, on each logged
// state, so the gap is measured and not taken from the motor area's word), stuck steps and why,
// what the goal channel did, and how often Jev and the planner were asked.
//   pnpm brain-report logs/player-....jsonl     (the CORTEX section)
import type { State, Workspace } from "@familiar/contracts";
import { playerConditions } from "@familiar/minecraft";

export interface CortexTick {
  timestamp: number;
  state: State;
  goal: { text: string; setBy: string; stepsDone: number; steps: string[]; protected?: boolean } | null;
  regions: { region: string; background?: boolean; trace?: Record<string, unknown> }[];
}
interface MotorTrace {
  step?: { index: number; text: string; skill?: string };
  advanced?: { step: number; why: string };
  stuck?: { step: number; why: string };
  unread?: Record<string, string>;
  ports?: { up?: { as?: string } | null };
}

const conditions = playerConditions();
const trace = <T>(t: CortexTick, region: string) => (t.regions.find((r) => r.region === region)?.trace ?? {}) as T;
const count = <T>(items: T[], by: (item: T) => string) => [...items.reduce((m, i) => m.set(by(i), (m.get(by(i)) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
const list = (counts: [string, number][], most = 6) => counts.slice(0, most).map(([k, n]) => `${k} ×${n}`).join(", ") || "none";
/** Whether a condition held on a logged state (the needs are read from the state alone). */
const held = (text: string, state: State) => conditions.parse(text)?.holds({ state, needs: null } as unknown as Workspace) ?? false;

export interface Finished {
  step: number;
  why: string;
  at: number;
  /** Ticks between the first logged state on which the condition held (while the step was under way) and the tick it was finished: 0 is the same tick. */
  ticksLate: number;
  msLate: number;
}

/** Every step the motor area finished, with how long after its condition first held. */
export function finishedSteps(ticks: CortexTick[]): Finished[] {
  const out: Finished[] = [];
  let began = 0;
  ticks.forEach((t, i) => {
    const m = trace<MotorTrace>(t, "motor");
    if (!m.advanced) return;
    const text = m.advanced.why.replace(/^done when: /, "");
    let first = i;
    while (first > began && held(text, ticks[first - 1]!.state)) first--;
    out.push({ step: m.advanced.step, why: m.advanced.why, at: t.timestamp, ticksLate: i - first, msLate: t.timestamp - ticks[first]!.timestamp });
    began = i;
  });
  return out;
}

/** Calls a minute of one deciding area: the runs in which it asked its engine or planner. */
function perMinute(ticks: CortexTick[], region: string, asked: string): string {
  const calls = ticks.flatMap((t) => t.regions.filter((r) => r.region === region && r.trace?.[asked] !== undefined)).length;
  const minutes = ticks.length > 1 ? (ticks.at(-1)!.timestamp - ticks[0]!.timestamp) / 60_000 : 0;
  return minutes > 0 ? `${calls} (${(calls / minutes).toFixed(1)} a minute)` : `${calls}`;
}

interface Found {
  what: string;
  kind: string;
  size: number;
  why: string;
}

/** What the sensory area found unexpected, and which of its readers reacted (each is a tick behind it). */
export function surpriseReport(ticks: CortexTick[]): { found: (Found & { at: number })[]; lines: string[] } {
  const found = ticks.flatMap((t) => ((trace<{ unexpected?: Found[] }>(t, "sensory").unexpected ?? []) as Found[]).map((f) => ({ ...f, at: t.timestamp })));
  if (!ticks.some((t) => t.regions.some((r) => r.region === "sensory"))) return { found, lines: ["  no sensory area in this run"] };
  const fresh = ticks.filter((t) => t.regions.some((r) => r.region === "sensory") && ((t as unknown as { signals?: Record<string, { value: number }> }).signals?.unexpected?.value ?? 0) > 0).length;
  const focus = ticks.filter((t) => ((trace<{ inputs?: Record<string, number> }>(t, "acetylcholine").inputs ?? {}).unexpected ?? 0) > 0).length;
  const keptBy = ticks.filter((t) => JSON.stringify(trace(t, "hippocampus")).includes("Was surprised")).length;
  const woken = ticks.flatMap((t) => t.regions.filter((r) => r.region === "prefrontal" && typeof r.trace?.woken === "string" && (r.trace.woken as string).startsWith("Something is not as expected"))).length;
  return {
    found,
    lines: [
      `  surprises: ${found.length}${found.length ? `: ${list(count(found, (f) => `${f.what} ${f.kind} (${f.size.toFixed(2)})`))}` : ""}; \`unexpected\` above 0 on ${fresh} ticks`,
      `  who reacted: focus took it in on ${focus} ticks; the hippocampus kept ${keptBy}; the planner was woken ${woken}×`,
    ],
  };
}

/** The planner's notes: what its plans did to them, and which it holds at the end. */
function notesLine(ticks: CortexTick[]): string {
  const changes = ticks.flatMap((t) => t.regions.filter((r) => r.region === "prefrontal" && r.trace?.notes).map((r) => r.trace!.notes as Record<string, string[]> & { held?: boolean }));
  if (!changes.length) return "  notes: none kept (off, or no plan yet)";
  const total = (what: string) => changes.reduce((n, c) => n + (c[what]?.length ?? 0), 0);
  const now = [...changes].reverse().find((c) => c.now)?.now ?? [];
  return `  notes: added ${total("added")}, changed ${total("changed")}, dropped ${total("dropped")}, lapsed unkept ${total("lapsed")}, refused ${total("refused")}; held as they were under a protected goal on ${changes.filter((c) => c.held).length} plans; in use at the end: ${now.join(", ") || "none"}`;
}

/** Learned skills: the chains noted, the skills made of them, how often each was run, and any retired. */
export function skillsLines(ticks: CortexTick[]): string[] {
  const chains = ticks.flatMap((t) => ((c) => (c === undefined ? [] : [c]))(trace<{ chain?: { links: { skill: string; target?: string }[]; seen: number; doneWhen: string } | string }>(t, "motor").chain));
  const kept = chains.filter((c): c is { links: { skill: string; target?: string }[]; seen: number; doneWhen: string } => typeof c !== "string");
  const made = ticks.flatMap((t) => t.regions.filter((r) => r.region === "prefrontal" && r.trace?.named).map((r) => r.trace!.named as { as: string; routine: { skill: string }[] }));
  const events = ticks.flatMap((t) => ((t as unknown as { skillEvents?: { skill: string; type: string; by?: string }[] }).skillEvents ?? []));
  const used = made.map((m) => `${m.as} (${m.routine.map((l) => l.skill).join(" > ")}): started ${events.filter((e) => e.skill === m.as && e.type === "started").length}×, done ${events.filter((e) => e.skill === m.as && e.type === "done").length}×, failed ${events.filter((e) => e.skill === m.as && e.type === "failed").length}×`);
  return [
    `  chains: ${kept.length} steps finished with a chain worth noting (${list(count(kept, (c) => `${c.links.map((l) => l.skill).join(" > ")} for "${c.doneWhen}"`), 4)}); not kept: ${list(count(chains.filter((c): c is string => typeof c === "string"), (c) => c), 3)}`,
    `  skills learned: ${made.length}${used.length ? `: ${used.join("; ")}` : ""}`,
  ];
}

export function cortexReport(ticks: CortexTick[]): string[] {
  const motor = ticks.map((t) => trace<MotorTrace>(t, "motor"));
  if (!ticks.some((t) => t.regions.some((r) => r.region === "motor"))) return ["  no motor area in this run"];
  const finished = finishedSteps(ticks);
  const as = count(motor.filter((m) => m.ports?.up?.as), (m) => m.ports!.up!.as!);
  const stuck = motor.flatMap((m) => (m.stuck ? [m.stuck] : []));
  const unread = motor.flatMap((m) => (m.unread ? Object.entries(m.unread).map(([port, text]) => `${port} "${text}"`) : []));
  const plans = ticks.flatMap((t) => t.regions.filter((r) => r.region === "prefrontal" && r.trace?.plan).map((r) => r.trace as { goalKept?: string; woken?: string; stepFinished?: boolean }));
  const kept = plans.filter((p) => p.goalKept);
  const woken = plans.filter((p) => p.woken);
  return [
    `  step under way, by how it was carried: ${list(as)} (ticks)`,
    `  steps finished by their condition: ${finished.length}${finished.length ? `; after the condition first held: ${list(count(finished, (f) => `${f.ticksLate} ticks`))} (the most ${Math.max(...finished.map((f) => f.msLate))} ms)` : ""}`,
    `  steps finished by the planner's word: ${plans.filter((p) => p.stepFinished).length}`,
    `  stuck steps: ${stuck.length}${stuck.length ? `: ${list(count(stuck, (s) => s.why.replace(/\d+(\.\d+)? s/g, "N s")))}` : ""}`,
    `  conditions not understood: ${list(count(unread, (u) => u), 4)}`,
    `  plans: ${plans.length}; woken by a stuck step ${woken.length}; kept out by the goal channel ${kept.length}${kept.length ? ` (${list(count(kept, (p) => p.goalKept!.replace(/\(.*?\)/g, "(n)")), 2)})` : ""}`,
    `  ticks under a protected goal: ${ticks.filter((t) => t.goal?.protected).length}`,
    `  Jev asked: ${perMinute(ticks, "instinct", "questions")}; the planner asked: ${perMinute(ticks, "prefrontal", "plan")}`,
    ...surpriseReport(ticks).lines,
    notesLine(ticks),
    ...skillsLines(ticks),
  ];
}
