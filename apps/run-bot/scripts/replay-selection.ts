import { NO_SELECTION } from "@familiar/basal-ganglia";
// Replays recorded runs through the old arbiter and the basal ganglia, side by side, and checks
// that they pick the same winner on every tick, and the winner the run recorded.
// Use it on logs recorded before a change to how the winner is picked.
//   pnpm replay-selection [--same-time] logs/player-....jsonl [more logs]
// What each tick is rebuilt from:
//   - the candidates: every region's recorded proposals (a background region's stand until it speaks again),
//     less those that ran alongside (a head-only look beside idling, or with --same-time beside a skill that leaves the head free);
//   - the workspace: the recorded state, running skill and signals;
//   - the needs and the scorebook: the hypothalamus and dopamine are run again on the recorded states
//     (so only runs that began with nothing learned can match the recording: the live checks do);
//   - the stay bonus: as the serotonin region logged it that tick; giving up: from the recorded skill events.
// Both arbiters are given exactly the same, so they must agree on every tick whatever the run.
// Against the recording a few ticks can differ: the clock had moved on a few milliseconds by the time the
// arbiter read it, and what was learned before the run is not in the log.
import { readFileSync } from "node:fs";
import type { Arbiter, Candidate, Region, RegionOutput, SkillEvent, State, Workspace } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { asleep, headFree, minecraftSkills, needsNow, playerNeeds, SCHEMA_VERSION, usesNothing } from "@familiar/minecraft";
import { createNoradrenalineRegion, createNoveltyMemory, createPatienceRegion, createScorebook, DEFAULT_NORADRENALINE, DEFAULT_PATIENCE, DEFAULT_PERSONALITY, retryAfter, type Persistence } from "@familiar/neuromodulators";
import { createHypothalamusRegion } from "@familiar/region-hypothalamus";
import { createArbiter, createOldArbiter, createPlayerDopamine } from "../dist/brain.js";

interface Recorded {
  timestamp: number;
  decideMs?: number;
  state: State & { data: { current?: { skill: string; target: string | null; secondsRunning: number } | null } };
  regions: { region: string; layer: number; background?: boolean; proposals?: Candidate[]; trace?: Record<string, unknown> }[];
  winner: Candidate | null;
  alongside?: Candidate;
  signals: Record<string, { value: number; source: string }>;
  skillEvents?: (SkillEvent & { alongside?: boolean })[];
}
interface Cue {
  thing: { id: string };
  skill: string;
}

const args = process.argv.slice(2);
const sameTime = args.includes("--same-time");
const files = args.filter((a) => !a.startsWith("--"));
if (!files.length) {
  console.error("Give one or more recorded runs: pnpm replay-selection logs/player-....jsonl");
  process.exit(1);
}

const skillNamed = (name: string | undefined) => minecraftSkills.find((s) => s.name === name);
/** The loop's rule for what runs alongside and so never competes (loop-mode.ts). */
function runsAlongside(c: Candidate, running: string | undefined): boolean {
  if (!("skill" in c.action)) return false;
  const skill = skillNamed(c.action.skill);
  if (skill?.reflexOnly && skill.parts?.length === 0) return true;
  const parts = skill?.parts;
  return parts?.length === 1 && parts[0] === "head" && (usesNothing(skillNamed(running)) || (sameTime && headFree(skillNamed(running))));
}
const key = (c: Candidate | null) => (c === null ? "nothing" : `${c.region}: ${"skill" in c.action ? `${c.action.skill} ${c.action.target ?? ""}` : JSON.stringify(c.action)}`.trim());

function replay(ticks: Recorded[]) {
  const store = createWorkspace();
  const scorebook = createScorebook();
  let allowed = new Map<string, string[]>();
  // The regions that learn and read the needs, run again so the scorebook and the needs are what they were.
  const regions: Region[] = [
    createHypothalamusRegion({ needs: playerNeeds }),
    createPlayerDopamine({ scorebook, novelty: createNoveltyMemory(), personality: DEFAULT_PERSONALITY, skillsToward: (thing) => allowed.get(thing.id) ?? [], asleep, usesBody: (skill) => skill !== "idle", surpriseLearning: 1 }),
    createNoradrenalineRegion({ needs: needsNow, startle: (ws) => ws.signals.startle?.value ?? 0, settings: DEFAULT_NORADRENALINE }),
    createPatienceRegion({ needs: needsNow, settings: DEFAULT_PATIENCE }),
  ];
  // Persistence as the recording shows it: the stay bonus the serotonin region logged, and the waits after each giving up.
  let stay: { skill: string; stayBonus: number } | null = null;
  const waiting = new Map<string, { times: number; until: number }>();
  const persistence = { stayBonus: (skill: string) => (stay?.skill === skill ? stay.stayBonus : 0), heldBack: (skill: string, now: number) => now < (waiting.get(skill)?.until ?? -Infinity) } as unknown as Persistence;
  let now = 0;
  const parts = { scorebook, personality: DEFAULT_PERSONALITY, patience: DEFAULT_PATIENCE, persistence, skills: minecraftSkills, now: () => now };
  const older: Arbiter = createOldArbiter(parts);
  // FULL=1: time the basal ganglia with every part on (the winners then differ from the old arbiter's, as they should).
  const newer: Arbiter = createArbiter(process.env.FULL ? parts : { ...parts, selection: NO_SELECTION });
  const signal = new AbortController().signal;
  const events = ticks.flatMap((t) => t.skillEvents ?? []).sort((x, y) => x.timestamp - y.timestamp);
  let seen = 0;
  const standing = new Map<string, Candidate[]>();
  const counts = { ticks: 0, agree: 0, recorded: 0, changedBy: new Map<string, number>() };
  let [firstDisagree, firstMiss]: (string | null)[] = [null, null];
  for (const [i, tick] of ticks.entries()) {
    while (seen < events.length && events[seen]!.timestamp <= tick.timestamp) {
      const event = events[seen++]!;
      if (event.alongside) continue;
      store.addEvent(event);
      if (event.type === "done") waiting.delete(event.skill);
      else if (event.type === "failed" && event.reason?.startsWith("gave up")) {
        const times = waiting.get(event.skill)?.times ?? 0;
        waiting.set(event.skill, { times: times + 1, until: event.timestamp + retryAfter(times + 3) });
      }
    }
    const running = tick.state.data.current ?? null;
    store.update(tick.state, running ? { skill: running.skill, target: running.target ?? undefined, startedAt: tick.timestamp - running.secondsRunning * 1000 } : null);
    for (const [name, s] of Object.entries(tick.signals)) if (name === "startle") store.viewFor(s.source).setSignal(name, s.value);
    allowed = new Map();
    for (const cue of (tick.regions.find((r) => r.region === "dopamine")?.trace?.cues as Cue[] | undefined) ?? []) allowed.set(cue.thing.id, [...(allowed.get(cue.thing.id) ?? []), cue.skill]);
    for (const region of regions) void (region.run(store.viewFor(region.name), signal) as RegionOutput);
    // The arbiter reads the workspace as the tick left it: the recorded signals, whatever the replayed regions said.
    for (const [name, s] of Object.entries(tick.signals)) store.viewFor(s.source).setSignal(name, s.value);
    stay = ((tick.regions.find((r) => r.region === "serotonin")?.trace?.persistence as typeof stay) ?? null);
    now = tick.timestamp + (tick.decideMs ?? 0);
    for (const r of tick.regions) if (r.background) standing.set(r.region, (r.proposals ?? []).map((p) => ({ ...p, region: r.region, layer: r.layer })));
    const spoke = tick.regions.filter((r) => !r.background).flatMap((r) => (r.proposals ?? []).map((p) => ({ ...p, region: r.region, layer: r.layer })));
    const candidates = [...[...standing.values()].flat(), ...spoke].filter((c) => !runsAlongside(c, running?.skill));
    const ws: Workspace = store.viewFor("arbiter");
    const [was, is] = [older.pick(candidates, ws), process.env.FULL ? newer.choose!([...[...standing.values()].flat(), ...spoke], ws).winner : newer.pick(candidates, ws)];
    counts.ticks++;
    if (key(was) === key(is)) counts.agree++;
    else firstDisagree ??= `tick ${i}: the old arbiter picked ${key(was)}, the basal ganglia ${key(is)}`;
    if (key(is) === key(tick.winner)) counts.recorded++;
    else firstMiss ??= `tick ${i}: recorded ${key(tick.winner)} (${tick.winner?.reason ?? ""}), replayed ${key(is)} (${is?.reason ?? ""})`;
    const trace = newer.trace?.() as { decidedBy?: string[]; ms?: number } | undefined;
    took.push(trace?.ms ?? 0);
    for (const term of trace?.decidedBy ?? []) counts.changedBy.set(term, (counts.changedBy.get(term) ?? 0) + 1);
  }
  return { counts, firstDisagree, firstMiss };
}

let failed = false;
const took: number[] = [];
console.log("run | ticks | old arbiter and basal ganglia agree | same winner as recorded | ticks a term decided");
for (const file of files) {
  const ticks = readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Recorded).filter((t) => t.regions && t.state)
    // A run recorded under an older schema is read as today's: what was added since is optional.
    .map((t) => ({ ...t, state: { ...t.state, schemaVersion: SCHEMA_VERSION } }));
  const { counts, firstDisagree, firstMiss } = replay(ticks);
  if (counts.agree !== counts.ticks && !process.env.FULL) failed = true;
  const decided = [...counts.changedBy].sort((a, b) => b[1] - a[1]).map(([term, n]) => `${term} ×${n}`).join(", ") || "none";
  console.log(`${file.replace(/^.*player-/, "").replace(".jsonl", "")} | ${counts.ticks} | ${counts.agree} of ${counts.ticks} | ${counts.recorded} of ${counts.ticks} | ${decided}`);
  if (firstDisagree) console.log(`    first disagreement: ${firstDisagree}`);
  if (firstMiss) console.log(`    first difference from the recording: ${firstMiss}`);
}
took.sort((a, b) => a - b);
console.log(`\nA choice by the basal ganglia took ${took[Math.floor(took.length / 2)]} ms (middle), ${took[Math.floor(took.length * 0.99)]} ms (99 in 100), ${took.at(-1)} ms (slowest); it should stay under 1.`);
console.log(failed ? "NOT the same: the old arbiter and the basal ganglia disagree, see above." : "The old arbiter and the basal ganglia picked the same winner on every tick of every run.");
process.exit(failed ? 1 : 0);
