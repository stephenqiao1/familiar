// Replays recorded runs through the parts of the brain that read the body's needs, and checks
// that they say what they said when the run was recorded: the same rewards, the same wants and
// proposals, the same alarm and the same outlook, tick for tick. Each run is replayed twice, with
// the hypothalamus reading the needs and with it left out, and the two must agree in full.
// Use it after changing how needs are read, on logs recorded before the change.
//   pnpm replay-needs logs/player-....jsonl [more logs]
// Only runs that started with nothing learned can be replayed (the live checks do: they clear
// data/<bot> first). What is not replayed: Jev, the reflexes, and anything that needs the body.
import { readFileSync } from "node:fs";
import type { Region, RegionOutput, SkillEvent, State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { asleep, needsNow, playerNeeds } from "@familiar/minecraft";
import { createNoradrenalineRegion, createNoveltyMemory, createPatienceRegion, createScorebook, DEFAULT_NORADRENALINE, DEFAULT_PATIENCE, DEFAULT_PERSONALITY } from "@familiar/neuromodulators";
import { createHypothalamusRegion } from "@familiar/region-hypothalamus";
import { createPlayerDopamine } from "../dist/brain.js";

interface Recorded {
  timestamp: number;
  state: State;
  regions: { region: string; proposals?: { action: { skill?: string; target?: string }; urgency: number }[]; trace?: Record<string, unknown> }[];
  signals: Record<string, { value: number; source: string }>;
  skillEvents?: SkillEvent[];
}
interface Cue {
  thing: { id: string; kind: string };
  skill: string;
  want: number;
}
/** What one tick said, in a form that can be compared. */
interface Said {
  rewards: string[];
  cues: string[];
  proposals: string[];
  alarm: number | null;
  outlook: number | null;
}

const round = (x: number) => Math.round(x * 1e9) / 1e9;
const traceOf = (regions: Recorded["regions"], name: string) => regions.find((r) => r.region === name);

/** What a tick's dopamine, noradrenaline and serotonin said (from a recorded tick, or a replayed one). */
function said(regions: Recorded["regions"]): Said {
  const dopamine = traceOf(regions, "dopamine");
  const rewards = ((dopamine?.trace?.rewards as { rule: string; amount: number }[] | undefined) ?? []).map((r) => `${r.rule} ${round(r.amount)}`).sort();
  const cues = ((dopamine?.trace?.cues as Cue[] | undefined) ?? []).map((c) => `${c.skill} ${c.thing.id} ${round(c.want)}`).sort();
  const proposals = (dopamine?.proposals ?? []).map((p) => `${p.action.skill} ${p.action.target} ${round(p.urgency)}`).sort();
  const alarm = traceOf(regions, "noradrenaline")?.trace?.alarm;
  const outlook = traceOf(regions, "serotonin")?.trace?.outlook;
  return { rewards, cues, proposals, alarm: typeof alarm === "number" ? round(alarm) : null, outlook: typeof outlook === "number" ? round(outlook) : null };
}

/** The signals the replayed regions read from others (the body's startle; who is asleep is in the state). */
const BORROWED = ["startle"];

function replay(ticks: Recorded[], withHypothalamus: boolean): Said[] {
  const store = createWorkspace();
  // The skills that could head to a thing on a tick are the body's to say; the recording shows which were wanted.
  let allowed = new Map<string, string[]>();
  const regions: Region[] = [
    ...(withHypothalamus ? [createHypothalamusRegion({ needs: playerNeeds })] : []),
    createPlayerDopamine({ scorebook: createScorebook(), novelty: createNoveltyMemory(), personality: DEFAULT_PERSONALITY, skillsToward: (thing) => allowed.get(thing.id) ?? [], asleep, usesBody: (skill) => skill !== "idle", surpriseLearning: 1 }),
    createNoradrenalineRegion({ needs: needsNow, startle: (ws) => ws.signals.startle?.value ?? 0, settings: DEFAULT_NORADRENALINE }),
    createPatienceRegion({ needs: needsNow, settings: DEFAULT_PATIENCE }),
  ];
  const signal = new AbortController().signal;
  // A tick's log holds the events up to its end; its regions saw only those from before it began.
  const events = ticks.flatMap((t) => t.skillEvents ?? []).sort((x, y) => x.timestamp - y.timestamp);
  let seen = 0;
  return ticks.map((tick) => {
    while (seen < events.length && events[seen]!.timestamp <= tick.timestamp) store.addEvent(events[seen++]!);
    store.update(tick.state, null);
    for (const name of BORROWED) if (tick.signals[name]) store.viewFor(tick.signals[name].source).setSignal(name, tick.signals[name].value);
    allowed = new Map();
    for (const cue of (traceOf(tick.regions, "dopamine")?.trace?.cues as Cue[] | undefined) ?? []) allowed.set(cue.thing.id, [...(allowed.get(cue.thing.id) ?? []), cue.skill]);
    return said(regions.map((region) => ({ region: region.name, ...(region.run(store.viewFor(region.name), signal) as RegionOutput) })) as Recorded["regions"]);
  });
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error("Give one or more recorded runs: pnpm replay-needs logs/player-....jsonl");
  process.exit(1);
}
const FIELDS = ["rewards", "cues", "proposals", "alarm", "outlook"] as const;
let failed = false;
console.log("run | ticks | rewards paid | wants | " + FIELDS.map((f) => `${f} same`).join(" | ") + " | with and without the hypothalamus");
for (const file of files) {
  const ticks = readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Recorded).filter((t) => t.regions && t.state);
  const recorded = ticks.map((t) => said(t.regions));
  const [withIt, without] = [replay(ticks, true), replay(ticks, false)];
  const same = (field: (typeof FIELDS)[number]) => recorded.filter((r, i) => JSON.stringify(r[field]) === JSON.stringify(withIt[i]![field])).length;
  const agree = withIt.filter((t, i) => JSON.stringify(t) === JSON.stringify(without[i])).length;
  const counts = FIELDS.map(same);
  if (counts.some((n) => n !== ticks.length) || agree !== ticks.length) failed = true;
  console.log(`${file.replace(/^.*player-/, "").replace(".jsonl", "")} | ${ticks.length} | ${recorded.reduce((n, r) => n + r.rewards.length, 0)} | ${recorded.reduce((n, r) => n + r.cues.length, 0)} | ${counts.map((n) => `${n} of ${ticks.length}`).join(" | ")} | ${agree} of ${ticks.length} agree`);
  for (const field of FIELDS) {
    const first = recorded.findIndex((r, i) => JSON.stringify(r[field]) !== JSON.stringify(withIt[i]![field]));
    if (first >= 0) console.log(`    first difference in ${field}, tick ${first}: recorded ${JSON.stringify(recorded[first]![field])}, replayed ${JSON.stringify(withIt[first]![field])}`);
  }
}
console.log(failed ? "\nNOT the same: see the differences above." : "\nThe same, tick for tick, in every run.");
process.exit(failed ? 1 : 0);
