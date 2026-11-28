// Live check of the two regions that watch: the insula (how the bot feels) and, in later stages,
// the cingulate. Every scene runs several times; the table gives each scene over all its runs.
//   pnpm monitor-check [--runs 5] [--minutes 10] [scene ...]
// `line`: ten minutes of ordinary play, with the feeling line as it changed.
// `shadow`: the cingulate in shadow over ordinary play with the Claude planner (run only when named).
// `inward` (scene 8): quiet rest with the Claude planner: the inward spell and the review (run only when named).
// `feeling` (scene 7): the same scene told as numbers, as the feeling line, and as both: what Jev picked.
import { playerNumber, rcon, sleep } from "./primitive-check/world.ts";
import { after, between, BOT, freshPlaza, play, type Tick } from "./live.ts";
import { READERS } from "@familiar/region-cingulate";
import { cingulateReport, type CingulateTick } from "./cingulate-report.ts";
import { insulaReport, lineOverTime, type InsulaTick } from "./insula-report.ts";

interface Row {
  scene: string;
  trouble: string;
  verdict: string;
  acted: string;
  outcome: string;
  problem: string;
}
const flag = (name: string, otherwise: number) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? Number(process.argv[at + 1]) : otherwise;
};
const RUNS = flag("runs", 5);
const MINUTES = flag("minutes", 10);
const wanted = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
const STILL = { colliculus: { scanning: 0 } };
const Y = 151;

const trace = (t: Tick, region: string) => (t.regions.find((r) => r.region === region)?.trace ?? {}) as Record<string, any>;
const tally = (keys: string[]) => [...keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
const shares = (keys: string[]) => tally(keys).map(([k, n]) => `${k} ${Math.round((100 * n) / keys.length)}%`).join(", ") || "nothing";
const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;

/** Jev's own pick on each tick it was asked (its answer to the action question), not what won. */
const picks = (ticks: Tick[]) => ticks.flatMap((t) => ((answers) => (answers ?? []).filter((a) => a.id === "next_action" && a.choice).map((a) => a.choice as string))(trace(t, "instinct").answers as { id: string; choice?: string }[] | undefined));
/** How sure Jev was of its pick, on average. */
const sureness = (ticks: Tick[]) => {
  const sure = ticks.flatMap((t) => ((answers) => (answers ?? []).filter((a) => a.id === "next_action").map((a) => a.confidence ?? 0))(trace(t, "instinct").answers as { id: string; confidence?: number }[] | undefined));
  return sure.length ? sure.reduce((a, b) => a + b, 0) / sure.length : 0;
};

/** One run of the feeling scene: hungry and a little hurt on the plaza, with nothing to eat on it and a few animals about. The body cannot settle it by reflex, so what is done is Jev's to pick. */
async function feelingRun(tell: number): Promise<{ ticks: Tick[]; note: string }> {
  await freshPlaza();
  for (let i = 0; i < 4; i++) rcon(`summon ${["cow", "sheep"][i % 2]} ${64.5 + i * 2} ${Y} 42.5 {NoAI:1b,Silent:1b,PersistenceRequired:1b}`);
  let at = 0;
  const ticks = await play(
    async () => {
      rcon(`effect give ${BOT} hunger 60 255 true`);
      for (let waited = 0; waited < 80 && !(playerNumber("foodLevel") <= 7); waited++) await sleep(500);
      rcon(`effect clear ${BOT} hunger`);
      rcon(`damage ${BOT} 6 minecraft:fall`);
      await sleep(1000);
      at = Date.now();
      await sleep(20_000);
    },
    { whole: true, settings: { ...STILL, insula: { tell } } },
  );
  const since = after(ticks, at);
  const started = tally(since.flatMap((t) => (t.skillEvents ?? []).filter((e) => e.type === "started" && !["look_at", "flinch", "brace"].includes(e.skill)).map((e) => e.skill)));
  const shown = since.map((t) => trace(t, "insula").line as string | undefined).find((line) => line !== undefined);
  return { ticks: since, note: `felt "${shown ?? "nothing"}"; Jev picked ${shares(picks(since))} (sure ${sureness(since).toFixed(2)}); skills started: ${started.map(([k, n]) => `${k} ×${n}`).join(", ") || "none"}` };
}


// ---- The switch (stage three): scenes 1 to 6. Every reader goes by the cingulate unless a scene says otherwise.

const cing = (t: Tick) => trace(t, "cingulate");
const most = (ticks: Tick[], read: (t: Tick) => number | undefined) => Math.max(0, ...ticks.map((t) => read(t) ?? 0));
const spot = (x: number, y = Y) => `pos:${x},${y},40`;
/** The plans the planner made: each with when, whether it was woken for it at once (`woken`) or told with a plan in its turn (`told`). */
const plansOf = (ticks: Tick[]) => ticks.flatMap((t) => t.regions.filter((r) => r.region === "prefrontal" && r.trace?.plan).map((r) => ({ at: t.timestamp, woken: r.trace!.woken as string | undefined, told: r.trace!.told as string | undefined })));
const verdicts = (ticks: Tick[]) => tally(ticks.flatMap((t) => (cing(t).verdict ? [cing(t).verdict as string] : []))).map(([k, n]) => `${k} ×${n}`).join(", ");
/** The faces of every event the ticks saw. */
const faces = (ticks: Tick[]) => [...new Set(ticks.flatMap((t) => ((cing(t).trouble?.events ?? []) as { kinds: string[] }[]).flatMap((e) => e.kinds)))].join(" + ") || "none";
const short = (text: string | undefined) => (text ? `"${text.replace(/^There is trouble: /, "").slice(0, 80)}"` : "nothing");
interface Run {
  ticks: Tick[];
  ok: boolean;
  note: string;
}
async function times(run: () => Promise<Run>): Promise<Run[]> {
  const out: Run[] = [];
  for (let i = 0; i < RUNS; i++) out.push(await run());
  return out;
}
const rowOf = (scene: string, runs: Run[], acted: string, extra = ""): Row => {
  const all = runs.flatMap((r) => r.ticks);
  return { scene, trouble: `up to ${most(all, (t) => cing(t).trouble?.level).toFixed(2)} (${faces(all)}); control up to ${most(all, (t) => cing(t).control).toFixed(2)}`, verdict: verdicts(all), acted, outcome: `${runs.filter((r) => r.ok).length} of ${runs.length} runs as expected. ${extra}Each run: ${runs.map((r) => r.note).join(" || ")}`, problem: runs.every((r) => r.ok) ? "" : `${runs.filter((r) => !r.ok).length} of ${runs.length} runs not as expected` };
};

/**
 * One hit on the plaza while a goal with a lot riding on it stands: `kind` is the game's kind of
 * damage ("fall" explains itself, "generic" has no cause to be seen). What the cingulate made of
 * it and what the planner was told, over the 25 seconds after.
 */
async function hitRun(kind: string, cingulate: object, want: (seen: { woken: string[]; told: string[]; ticks: Tick[] }) => boolean): Promise<Run> {
  await freshPlaza();
  let at = 0;
  const ticks = await play(
    async () => {
      await sleep(8000);
      at = Date.now();
      rcon(`damage ${BOT} 6 minecraft:${kind}`);
      await sleep(25_000);
    },
    { whole: true, plan: { goal: "Keep watch over the plaza: it matters a great deal.", steps: [], reason: "", priority: 0.9 }, settings: { ...STILL, cingulate } },
  );
  const since = after(ticks, at);
  const plans = plansOf(since);
  const [woken, told] = [plans.flatMap((p) => (p.woken ? [p.woken] : [])), plans.flatMap((p) => (p.told ? [p.told] : []))];
  const why = since.map((t) => cing(t).why as string | undefined).find(Boolean);
  const uneasy = most(since, (t) => (trace(t, "insula").uneasy as { level: number } | undefined)?.level);
  return { ticks: since, ok: want({ woken, told, ticks: since }), note: `trouble ${most(since, (t) => cing(t).trouble?.level).toFixed(2)} (${faces(since)}), control ${most(since, (t) => cing(t).control).toFixed(2)}${why ? ` (${why})` : ""}, uneasy ${uneasy.toFixed(2)}; ${plans.length} plans, woken ${woken.length}× ${short(woken[0])}, told in turn ${told.length}× ${short(told[0])}` };
}

/** A minute of ordinary life on the plaza with Jev and a goal of the given priority: the near ties, and how often the deciders were hurried for one. */
async function tieRun(priority: number): Promise<Run> {
  await freshPlaza();
  for (let i = 0; i < 4; i++) rcon(`summon ${["cow", "sheep"][i % 2]} ${64.5 + i * 2} ${Y} 42.5 {Silent:1b,PersistenceRequired:1b}`);
  const ticks = await play(async () => void (await sleep(60_000)), { whole: true, plan: { goal: "Look around the plaza.", steps: [], reason: "", priority } });
  const tied = ticks.filter((t) => (t.signals.conflict?.value ?? 0) > 0);
  const hurried = ticks.filter((t) => cing(t).readBy?.gate === "hurried");
  const jev = ticks.filter((t) => trace(t, "instinct").answers).length;
  return { ticks, ok: true, note: `${tied.length} ticks in a near tie, control on them up to ${most(tied, (t) => cing(t).control).toFixed(2)} (stake ${most(tied, (t) => cing(t).stake).toFixed(2)}); deciders hurried on ${hurried.length} ticks; Jev asked ${jev}×` };
}

/**
 * Stay or leave: a walk that pays (three steps down the plaza, each finished), then a step that
 * cannot be done (a spot in mid-air: the walk keeps trying and gets nowhere). When the skill is
 * dropped and why, with the give-up clock reading `leave` (`patience` 1) or not (0).
 */
async function leaveRun(patience: number): Promise<Run> {
  await freshPlaza();
  const walk = (x: number) => ({ text: `walk to ${x}`, skill: "go_to", target: spot(x), doneWhen: `within 3 of ${spot(x)}` });
  const plan = { goal: "Walk the plaza end to end, then up to the high ledge.", steps: [walk(48), walk(74), walk(48), { text: "walk to the high ledge", skill: "go_to", target: spot(60, Y + 9), doneWhen: `within 2 of ${spot(60, Y + 9)}` }], reason: "", priority: 0.6 };
  const ticks = await play(async () => void (await sleep(200_000)), { whole: true, plan, settings: { ...STILL, cingulate: { readers: { patience } } } });
  const start = ticks[0]!.timestamp;
  const cannot = ticks.find((t) => (t.goal as { stepsDone?: number } | null | undefined)?.stepsDone === 3);
  const gaveUp = ticks.flatMap((t) => (t.skillEvents ?? []).filter((e) => e.type === "failed" && (e.reason ?? "").startsWith("gave up")).map((e) => ({ at: t.timestamp, reason: e.reason! })));
  const first = cannot ? gaveUp.find((g) => g.at >= cannot.timestamp) : undefined;
  const leaveIt = ticks.find((t) => cing(t).verdict === "leave it");
  return {
    ticks,
    ok: cannot !== undefined && (patience === 0 || first !== undefined),
    note: `the step that cannot be done began ${cannot ? `${Math.round((cannot.timestamp - start) / 1000)} s in` : "never"}; \`leave\` up to ${most(ticks, (t) => cing(t).leave?.level).toFixed(2)}; verdict "leave it" ${leaveIt && cannot ? `${Math.round((leaveIt.timestamp - cannot.timestamp) / 1000)} s after` : "never"} (${(leaveIt && (cing(leaveIt).why as string)) ?? ""}); gave up ${first && cannot ? `${Math.round((first.at - cannot.timestamp) / 1000)} s after: ${first.reason}` : "never"} (${gaveUp.length} give-ups in all)`,
  };
}

/** One run of the inward scene. */
async function inwardRun(): Promise<Run> {
  await freshPlaza();
  let hit = 0;
  const ticks = await play(
    async () => {
      await sleep(8000);
      rcon(`damage ${BOT} 4 minecraft:fall`);
      await sleep(300_000);
      hit = Date.now();
      rcon(`damage ${BOT} 4 minecraft:generic`);
      await sleep(20_000);
    },
    // Nothing carries a plan out (no instinct, no motor area), so the body stays still: awake rest is rare in ordinary play.
    { whole: true, without: ["instinct", "motor"], awakeDays: 3, before: ["time set 1000"], flags: ["--planner", "claude"], settings: STILL },
  );
  const start = ticks[0]!.timestamp;
  const secs = (t: Tick | undefined) => (t ? `${Math.round((t.timestamp - start) / 1000)} s in` : "never");
  const inward = (t: Tick) => cing(t).inward !== undefined;
  const spells = new Set(ticks.flatMap((t) => (inward(t) ? [(cing(t).inward as { since: number }).since] : [])));
  const reviews = ticks.flatMap((t) => t.regions.filter((r) => r.region === "prefrontal" && r.trace?.review).map((r) => ({ t, review: r.trace!.review as { shown: { notes: { key: string; text: string }[]; memories: string[]; feeling: string | null }; said: { notes?: { key: string; text: string }[] }; notes: Record<string, string[]> } })));
  const plans = (some: Tick[]) => some.flatMap((t) => t.regions.filter((r) => r.region === "prefrontal" && r.trace?.plan)).length;
  // Guardrails: never inward with trouble up; the hit ends it on the tick trouble rises; a review changes no goal.
  const troubled = ticks.filter((t) => inward(t) && (cing(t).trouble?.level ?? 0) >= 0.1).length;
  const afterHit = after(ticks, hit);
  const rose = afterHit.find((t) => (cing(t).trouble?.level ?? 0) >= 0.1);
  const stillInward = rose ? inward(rose) : true;
  const sorted = ticks.filter((t) => trace(t, "hippocampus").consolidation !== undefined);
  const goalChanged = reviews.filter(({ t }) => ((i) => i > 0 && JSON.stringify(ticks[i - 1]!.goal) !== JSON.stringify(t.goal))(ticks.indexOf(t))).length;
  const change = (r: (typeof reviews)[number]["review"]) => Object.entries(r.notes).filter(([k, v]) => k !== "now" && v.length).map(([k, v]) => `${k}: ${v.join(", ")}`).join("; ") || "nothing";
  const told = reviews.map(({ t, review }) => `review ${secs(t)}: shown ${review.shown.notes.length} notes, ${review.shown.memories.length} memories (${review.shown.memories.map((m) => `"${m.slice(0, 50)}"`).join(", ") || "none"}), feeling "${review.shown.feeling}"; notes after: ${change(review)}; now ${(review.said.notes ?? []).map((n) => `[${n.key}: ${n.text.slice(0, 90)}]`).join(" ") || "none"}`);
  return {
    ticks,
    ok: spells.size > 0 && reviews.length <= spells.size && troubled === 0 && !stillInward && goalChanged === 0,
    note: `quiet ${secs(ticks.find((t) => (t.signals.quiet?.value ?? 0) > 0))}, inward ${secs(ticks.find(inward))} (${spells.size} spells, ${ticks.filter(inward).length} ticks); memories sorted on ${sorted.length} ticks, ${sorted.filter((t) => !inward(t)).length} of them not inward; ${plans(ticks)} plans, ${plans(ticks.filter(inward))} while inward; ${told.join(" | ") || "no review"}; the second hit: trouble rose ${rose ? `${rose.timestamp - hit} ms after` : "never"}, inward on that tick: ${stillInward ? "yes" : "no"}`,
  };
}

/** Six quiet minutes (things are called changeable only against what is usual, and a bot a minute old has no usual yet), then 45 seconds in which things keep appearing and going and the body keeps being hurt, then two and a half quiet minutes: what the learning rates were multiplied by. */
async function changeRun(): Promise<Run> {
  await freshPlaza();
  let [from, to] = [0, 0];
  const ticks = await play(
    async () => {
      await sleep(360_000);
      from = Date.now();
      for (let i = 0; i < 9; i++) {
        rcon(`summon ${["cow", "pig", "sheep", "chicken"][i % 4]} ${63.5 + (i % 3) * 2} ${Y} ${39.5 + (i % 2) * 2} {NoAI:1b,Silent:1b,Tags:["passing"]}`);
        if (i % 3 === 1) rcon(`damage ${BOT} 2 minecraft:generic`);
        await sleep(2500);
        rcon("kill @e[tag=passing]");
        await sleep(2500);
      }
      to = Date.now();
      await sleep(150_000);
    },
    { whole: true, settings: STILL },
  );
  const rate = (some: Tick[]) => some.flatMap((t) => (cing(t).readBy?.learning === undefined ? [] : [cing(t).readBy.learning as number]));
  const [before, during, later] = [rate(ticks.filter((t) => t.timestamp < from)), rate(between(ticks, from, to + 30_000)), rate(after(ticks, to + 120_000))];
  const [low, peak, settled] = [Math.max(0, ...before), Math.max(0, ...during), later.length ? later.at(-1)! : NaN];
  return { ticks, ok: peak > low && settled < peak, note: `learning rates ×${low.toFixed(2)} at most before, ×${peak.toFixed(2)} at the height of it, ×${settled.toFixed(2)} at the end; changeable up to ${most(ticks, (t) => cing(t).changeable?.level).toFixed(2)}` };
}

/** Ordinary play at the base with Jev and the Claude planner (`--minutes`, 30 for the stage reports): the cingulate in shadow (every reader at 0), or with the switch on. */
async function ordinary(on: boolean): Promise<Row> {
    for (const command of ["gamerule spawn_mobs false", "weather clear", "time set 1000"]) rcon(command);
    const ticks = await play(async () => void (await sleep(MINUTES * 60_000)), { whole: true, start: "-7.5 69 13.5 0 0", flags: ["--planner", "claude"], ...(on ? {} : { settings: { cingulate: { inward: 0, readers: Object.fromEntries(READERS.map((r) => [r, 0])) } } }) });
    const report = cingulateReport(ticks as unknown as CingulateTick[]);
    console.log(report.join("\n"));
    console.log(insulaReport(ticks as unknown as InsulaTick[]).join("\n"));
    const verdicts = tally(ticks.flatMap((t) => (trace(t, "cingulate").verdict ? [trace(t, "cingulate").verdict as string] : [])));
    const most = Math.max(0, ...ticks.map((t) => trace(t, "cingulate").trouble?.level ?? 0));
    return { scene: `the cingulate ${on ? "with the switch on" : "in shadow"} (${MINUTES} minutes of ordinary play, Jev and the Claude planner)`, trouble: `up to ${most.toFixed(2)}`, verdict: verdicts.map(([k, n]) => `${k} ×${n}`).join(", "), acted: on ? "every reader" : "nobody (shadow)", outcome: report.slice(0, 11).map((l) => l.trim()).join(" | "), problem: report.length > 1 ? "" : "no cingulate was traced" };
}

const scenes: Record<string, () => Promise<Row>> = {
  /** Ten minutes of ordinary play at the base with Jev: the feeling line as it changed. */
  async line() {
    for (const command of ["gamerule spawn_mobs false", "weather clear", "time set 1000"]) rcon(command);
    const ticks = await play(async () => void (await sleep(MINUTES * 60_000)), { whole: true, start: "-7.5 69 13.5 0 0" });
    const changes = lineOverTime(ticks as unknown as InsulaTick[]);
    console.log(changes.map((c) => `    ${clock(c.at)}  Feels: ${c.line}.`).join("\n"));
    console.log(insulaReport(ticks as unknown as InsulaTick[]).join("\n"));
    const told = ticks.filter((t) => JSON.stringify(trace(t, "instinct").questions ?? "").length > 2).length;
    return { scene: `the feeling line (${MINUTES} minutes of ordinary play, Jev on)`, trouble: "", verdict: "", acted: `Jev asked ${told}×`, outcome: `${changes.length} lines: ${changes.map((c) => `${clock(c.at)} ${c.line}`).join(" | ")}`, problem: changes.length ? "" : "no feeling was traced" };
  },

  /** The cingulate in shadow: 30 minutes of ordinary play, and what it would have done beside what happened. */
  async shadow() {
    return ordinary(false);
  },

  /** The same with the switch on: every reader goes by the cingulate. */
  async switched() {
    return ordinary(true);
  },

  /** 1. One event, one wake: a fall's worth of harm with a lot at stake. Pain, a change of plan asked for and whatever else it trips are one event: the planner is woken once and told why. */
  async one() {
    return rowOf("1 one event, one wake (a hit with a lot at stake; Jev on, echo planner)", await times(() => hitRun("fall", {}, (seen) => seen.woken.length === 1 && seen.told.length === 0)), "the planner, once");
  },

  /** 2. Worth it: near ties in a minute of ordinary life, with a lot at stake (a goal of priority 1) and with little (0.1). */
  async worth() {
    const [high, low] = [await times(() => tieRun(1)), await times(() => tieRun(0.1))];
    const hurried = (runs: Run[]) => runs.flatMap((r) => r.ticks).filter((t) => cing(t).readBy?.gate === "hurried").length;
    const tied = (runs: Run[]) => runs.flatMap((r) => r.ticks).filter((t) => (t.signals.conflict?.value ?? 0) > 0).length;
    const out = rowOf("2 worth it (near ties in a minute of ordinary life, Jev on)", [...high, ...low], "the deciders' gate", `A lot at stake: ${tied(high)} ticks in a near tie, deciders hurried on ${hurried(high)}. Little at stake: ${tied(low)} in a near tie, hurried on ${hurried(low)}. `);
    return { ...out, problem: hurried(low) > 0 ? "the deciders were hurried with little at stake" : tied(high) > 0 && hurried(high) === 0 ? "near ties with a lot at stake hurried nobody" : "" };
  },

  /** 3. Not worth it: the same hit as scene 1 with the call budget already spent (a budget of 1 call a minute). The verdict is to carry on, and the planner is not woken: it is told with its next plan in turn. */
  async spent() {
    return rowOf("3 not worth it (the same hit with the call budget spent)", await times(() => hitRun("fall", { callBudget: 1 }, (seen) => seen.woken.length === 0 && seen.ticks.some((t) => cing(t).why === "the call budget is spent"))), "nobody (told in turn)");
  },

  /** 4. Leave: a walk that pays, then a step that cannot be done. With the give-up clock reading `leave`, and without. */
  async leave() {
    const [on, off] = [await times(() => leaveRun(1)), await times(() => leaveRun(0))];
    return rowOf("4 leave (a walk that pays, then one that cannot be done)", [...on, ...off], "the give-up clock", `The first ${RUNS} runs read \`leave\`, the last ${RUNS} do not. `);
  },

  /** 5. Changeable: six quiet minutes, a burst of surprises, then quiet again. The learning rates rise, then settle. */
  async changeable() {
    return rowOf("5 changeable (six quiet minutes, 45 s of surprises, then quiet)", await times(changeRun), "the three learning rates");
  },

  /** 6. Unexplained harm: health lost with no cause to be seen, with a lot at stake. The bot is uneasy and the planner is told so. */
  async harm() {
    return rowOf("6 unexplained harm (health lost with no cause to be seen)", await times(() => hitRun("generic", {}, (seen) => [...seen.woken, ...seen.told].some((note) => note.includes("no cause to be seen")) && seen.ticks.some((t) => ((trace(t, "insula").uneasy as { level: number } | undefined)?.level ?? 0) > 0))), "the planner");
  },

  /** 8. Inward: a hit, then five quiet minutes by day for a bot too tired to stay sharp, then another hit. When it looked inward, what the review was shown and did to the notes, and whether the second hit ended it at once. Claude planner; run only when named. */
  async inward() {
    return rowOf("8 inward (a hit, five quiet minutes, a hit; Claude planner, nothing to carry its plans out)", await times(inwardRun), "the hippocampus and the planner's review");
  },

  /** 7. Feeling: the same scene told as numbers, as a feeling line, and as both. What Jev picked. */
  async feeling() {
    const arms: [string, number][] = [["numbers alone", 0], ["the line alone", 1], ["both", 0.5]];
    const out: string[] = [];
    for (const [name, tell] of arms) {
      const all: Tick[] = [];
      const notes: string[] = [];
      for (let i = 0; i < RUNS; i++) {
        const run = await feelingRun(tell);
        all.push(...run.ticks);
        notes.push(run.note);
      }
      out.push(`${name} (${RUNS} runs): Jev picked ${shares(picks(all))} (sure ${sureness(all).toFixed(2)}). Each run: ${notes.join(" || ")}`);
    }
    return { scene: "7 feeling (hungry and a little hurt, nothing to eat on it; Jev on)", trouble: "", verdict: "", acted: "Jev", outcome: out.join(" ||| "), problem: "" };
  },
};

/** A long scene that is run only when named. */
const LONG = ["line", "shadow", "switched", "leave", "changeable", "inward"];
const names = wanted.length ? wanted : Object.keys(scenes).filter((name) => !LONG.includes(name));
const unknown = names.filter((name) => !scenes[name]);
if (unknown.length) {
  console.error(`Unknown scene(s): ${unknown.join(", ")}. Use: ${Object.keys(scenes).join(", ")}`);
  process.exit(1);
}
const rows: Row[] = [];
for (const name of names) {
  console.log(`=== ${name}`);
  try {
    const made = await scenes[name]!();
    rows.push(made);
    console.log(`    ${made.problem ? `PROBLEM: ${made.problem}` : "no problem seen"}`);
  } catch (error) {
    rows.push({ scene: name, trouble: "", verdict: "", acted: "", outcome: "", problem: `the scene broke: ${error instanceof Error ? error.message : error}` });
    console.log(`    BROKE: ${error instanceof Error ? error.message : error}`);
  }
}
rcon(`tp ${BOT} -8 69 14`);
console.log("\nscene | trouble | verdict | who acted | outcome");
for (const r of rows) console.log(`${r.scene} | ${r.trouble} | ${r.verdict} | ${r.acted} | ${r.outcome}${r.problem ? ` PROBLEM: ${r.problem}` : ""}`);
const problems = rows.filter((r) => r.problem);
console.log(`\n${rows.length} scenes; ${problems.length} showed a problem${problems.length ? `: ${problems.map((r) => r.scene).join(", ")}` : ""}.`);
