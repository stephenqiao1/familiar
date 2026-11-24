// Replays recorded runs through the thalamus and checks that the deciding layers are told what
// they were told when the run was recorded: the same view of the state, the same targets
// offered to Jev, and the same lines about the state in the planner's text, tick for tick.
// Use it on logs recorded before a change to the thalamus.
//   pnpm replay-views logs/player-....jsonl [more logs]
// What it compares, for each tick:
//   - the view against the old way of making it (the field-of-view filter straight on the state);
//   - Jev's target options against the ones recorded in the instinct trace;
//   - the planner's lines about the state against those in each recorded plan (a plan is logged
//     when it comes back, so its lines are looked for in the ticks just before).
// Each run is tried with the field of view off, then on; the one that fits is reported.
// A run recorded under an older state schema is read as today's (the fields added since are
// optional). Not replayed: the action menu (what a skill can run needs the live body) and the planner's
// notes (memories, storage). A recorded state was already cut to the attention budget by the
// encoder of its day, so the thalamus's own cut by count has nothing to do here: that the two
// cuts agree is shown by the encoder's busy-world test.
import { readFileSync } from "node:fs";
import type { State } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { createFieldOfView, describeSituation, playerThalamus, SCHEMA_VERSION, thingsInView } from "@familiar/minecraft";
import { buildTargetQuestion } from "@familiar/region-instinct";
import { createThalamusRegion, THALAMUS_OFF } from "@familiar/region-thalamus";

interface Recorded {
  timestamp: number;
  state: State;
  regions: { region: string; trace?: { questions?: { id: string; options?: string[] }[]; situation?: string } }[];
}

const DECIDERS = ["instinct", "prefrontal"];
/** The lines of the planner's text that come from the state: from the second line to "Doing now". */
const stateLines = (text: string) => {
  const lines = text.split("\n");
  const end = lines.findIndex((line) => line.startsWith("Doing now:"));
  return end < 0 ? null : lines.slice(1, end + 1).join("\n");
};
/** A plan's text was built from one of this many ticks before it was logged. */
const PLAN_WITHIN_TICKS = 120;

function replay(ticks: Recorded[], fieldOfView: number) {
  const store = createWorkspace();
  const thalamus = createThalamusRegion({ ...playerThalamus(), readers: DECIDERS, settings: { ...THALAMUS_OFF, fieldOfView } });
  const old = createFieldOfView();
  const signal = new AbortController().signal;
  const counts = { ticks: ticks.length, views: 0, asked: 0, targets: 0, plans: 0, planLines: 0 };
  const told: string[] = [];
  let firstMiss: string | null = null;
  for (const [i, tick] of ticks.entries()) {
    store.update(tick.state, null);
    void thalamus.run(store.viewFor("thalamus"), signal);
    const ws = store.viewFor("replay");
    // The view, against the old way: the filter straight on the state (or the state itself with it off).
    const before = fieldOfView > 0 ? old.tell(tick.state) : tick.state;
    const same = DECIDERS.every((reader) => JSON.stringify(ws.view(reader)) === JSON.stringify(before));
    if (same) counts.views++;
    else firstMiss ??= `tick ${i}: the view differs from the old filter`;
    // Jev's targets, against the recording.
    const asked = tick.regions.find((r) => r.region === "instinct")?.trace?.questions?.find((q) => q.id === "target");
    if (asked) {
      counts.asked++;
      const now = buildTargetQuestion(thingsInView(ws.view("instinct")).map((t) => t.id)).options;
      if (JSON.stringify(now) === JSON.stringify(asked.options)) counts.targets++;
      else firstMiss ??= `tick ${i}: Jev was offered ${JSON.stringify(asked.options)}, now ${JSON.stringify(now)}`;
    }
    // The planner's lines about the state, against each recorded plan.
    told.push(stateLines(describeSituation(ws, [])) ?? "");
    const plan = tick.regions.find((r) => r.region === "prefrontal")?.trace?.situation;
    const lines = plan ? stateLines(plan) : null;
    if (lines !== null) {
      counts.plans++;
      if (told.slice(-PLAN_WITHIN_TICKS).includes(lines)) counts.planLines++;
      else firstMiss ??= `tick ${i}: the planner's lines about the state were not reproduced`;
    }
  }
  const ok = counts.views === counts.ticks && counts.targets === counts.asked && counts.planLines === counts.plans;
  return { counts, ok, firstMiss };
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error("Give one or more recorded runs: pnpm replay-views logs/player-....jsonl");
  process.exit(1);
}
let failed = false;
console.log("run | field of view | ticks | view same as the old filter | Jev's targets same as recorded | planner's state lines same as recorded");
for (const file of files) {
  const ticks = readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Recorded).filter((t) => t.regions && t.state)
    // A run recorded under an older schema is read as today's: what was added since is optional.
    .map((t) => ({ ...t, state: { ...t.state, schemaVersion: SCHEMA_VERSION } }));
  const [off, on] = [replay(ticks, 0), replay(ticks, 1)];
  const fit = off.ok ? { ...off, name: "off" } : on.ok ? { ...on, name: "on" } : { ...off, name: "off (does not fit; nor does on)" };
  if (!fit.ok) failed = true;
  const { counts } = fit;
  console.log(`${file.replace(/^.*player-/, "").replace(".jsonl", "")} | ${fit.name} | ${counts.ticks} | ${counts.views} of ${counts.ticks} | ${counts.targets} of ${counts.asked} | ${counts.planLines} of ${counts.plans}`);
  if (!fit.ok) console.log(`    first difference: ${off.firstMiss}; with the field of view on: ${on.firstMiss}`);
}
console.log(failed ? "\nNOT the same: see the differences above." : "\nThe same, tick for tick, in every run.");
process.exit(failed ? 1 : 0);
