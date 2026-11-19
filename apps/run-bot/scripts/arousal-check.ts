// Live check of the reticular formation on the test server: bedtime, staying up, deep and light
// sleep, waking for hunger, dawn, the graded gate, quiet rest and over-arousal. No Jev and no
// planner calls, except the frazzled scene (Jev, to see what instinct is offered).
// Needs the server container (MC_CONTAINER, default familiar-m6) and the base bed.
//   pnpm arousal-check [scene ...]
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { buildPlaza, rcon, sleep } from "./primitive-check/world.ts";

const BOT = "Dozer";
/** Every region but instinct: nothing but the reticular formation can decide to go to bed. */
const NO_INSTINCT = "reflex,medulla,brainstem,reticular,colliculus,acetylcholine,dopamine,noradrenaline,hippocampus,serotonin,prefrontal";
const ALL = `${NO_INSTINCT},instinct`;
/** Beside the base bed (the bed is at -8 68 15). */
const HOME = "-7.5 69 13.5 0 0";
/** The plaza in the sky: more than 64 blocks from the bed, so no bed is in reach. */
const PLAZA = "60.5 151 40.5 -90 0";
/** A bang high above the bed, about 40 blocks up, where it breaks nothing: quiet by the time it gets down. */
const FAR_BANG = "summon tnt -8 108 15 {fuse:0}";
const TICKS_PER_DAY = 24_000;

interface Reticular {
  band?: string;
  arousal?: number;
  rate?: number;
  asleep?: boolean;
  depth?: number;
  groggy?: boolean;
  wake?: { value: number; by: string };
  waking?: { by: string; strength: number; depth: number; sleptMs: number; calm: boolean };
  bedtime?: { sleepy: number; proposed?: number; delayed?: string };
}
interface Tick {
  tick: number;
  timestamp: number;
  state: { data: { self: { health: number; food: number; asleep: boolean; position: { x: number; z: number } } } };
  winner: { region: string; action: { skill?: string } } | null;
  regions: { region: string; proposals: { action: { skill?: string }; urgency: number }[]; trace?: Record<string, unknown> }[];
  signals: Record<string, { value: number }>;
  skillEvents?: { skill: string; type: string; timestamp: number; reason?: string }[];
}

interface Options {
  /** Where it starts. Default: beside the bed. */
  at?: string;
  /** How many game days it has been awake. Default: 0 (it has just slept). */
  awakeDays?: number;
  regions?: string;
  /** Run instinct on Jev. Default: the offline stand-in. */
  jev?: boolean;
  give?: string[];
  /** World commands before the bot joins. */
  before?: string[];
}

/** Runs the real bot; `act` scripts the scene while it runs. */
async function play(act: (say: (command: string) => void) => Promise<void>, options: Options = {}): Promise<Tick[]> {
  rmSync(`data/${BOT}`, { recursive: true, force: true });
  for (const command of options.before ?? []) rcon(command);
  // How long it has been awake is kept as the world's age when it last woke.
  const age = Number(/(\d+)\s*$/.exec(rcon("time query gametime"))?.[1] ?? NaN);
  if (!Number.isFinite(age)) throw new Error("could not read the world's age");
  mkdirSync(`data/${BOT}`, { recursive: true });
  writeFileSync(`data/${BOT}/body.json`, JSON.stringify({ sleptAtAge: Math.max(0, age - Math.round((options.awakeDays ?? 0) * TICKS_PER_DAY)) }));
  const child = spawn("node", ["--env-file-if-exists=.env", "apps/run-bot/dist/index.js", "--engine", options.jev ? "jev" : "echo", "--planner", "echo", "--regions", options.regions ?? NO_INSTINCT, "--manual", "--name", BOT], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  let exited = false;
  child.stdout.on("data", (d: Buffer) => (output += d));
  child.stderr.on("data", (d: Buffer) => (output += d));
  child.once("exit", () => (exited = true));
  const joined = Date.now();
  while (!output.includes("Logging to") && !exited && Date.now() - joined < 30_000) await sleep(200);
  if (exited) throw new Error(`The bot stopped before it started playing:\n${output.slice(-500)}`);
  for (const command of [`gamemode survival ${BOT}`, `clear ${BOT}`, `effect clear ${BOT}`, `effect give ${BOT} instant_health 1 10 true`, `effect give ${BOT} saturation 1 10 true`, ...(options.give ?? []).map((item) => `give ${BOT} ${item}`), `tp ${BOT} ${options.at ?? HOME}`]) rcon(command);
  await sleep(1500);
  try {
    await act((command) => void child.stdin.write(`${command}\n`));
  } finally {
    child.stdin.end();
    child.kill("SIGINT");
    const hard = setTimeout(() => child.kill("SIGKILL"), 8000);
    if (!exited) await new Promise((resolve) => child.once("exit", resolve));
    clearTimeout(hard);
  }
  const file = output.match(/Logging to (\S+)/)?.[1];
  if (!file) throw new Error("no log file");
  console.log(`    log: ${file}`);
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Tick);
}

/** A calm world: no mobs, clear weather, and a night that is not skipped when the only player sleeps. */
const CALM = ["gamerule spawn_mobs false", "difficulty peaceful", "weather clear", "gamerule players_sleeping_percentage 101", "kill @e[type=item]"];
const night = (time = 14_000) => [...CALM, `time set ${time}`];
const dayTime = [...CALM, "time set 3000"];

const ret = (t: Tick) => (t.regions.find((r) => r.region === "reticular")?.trace ?? {}) as Reticular;
const traceOf = (t: Tick, region: string) => t.regions.find((r) => r.region === region)?.trace ?? {};
const events = (ticks: Tick[], skill: string, type: string) => ticks.flatMap((t) => (t.skillEvents ?? []).filter((e) => e.skill === skill && e.type === type));
const bandsOf = (ticks: Tick[]) => [...new Set(ticks.flatMap((t) => ret(t).band ?? []))].join(", ");
const wakingsOf = (ticks: Tick[]) => ticks.flatMap((t) => (ret(t).waking ? [ret(t).waking!] : []));
const saved = (ticks: Tick[]) => ticks.filter((t) => traceOf(t, "instinct").paused === true).length;
const made = (ticks: Tick[]) => ticks.filter((t) => traceOf(t, "instinct").engine !== undefined).length;
const level = (t: Tick | undefined, signal: string) => t?.signals[signal]?.value ?? 0;
const firstAsleep = (ticks: Tick[]) => ticks.find((t) => t.state.data.self.asleep);
const secondsIn = (ticks: Tick[], t: Tick | undefined) => (t ? ((t.timestamp - ticks[0]!.timestamp) / 1000).toFixed(0) : "never");
/** Waits until the server says the bot is asleep (or gives up). */
async function untilAsleep(seconds: number): Promise<boolean> {
  for (let i = 0; i < seconds * 2; i++) {
    if (/:\s*[1-9]\d*s\s*$/.test(rcon(`data get entity ${BOT} SleepTimer`))) return true;
    await sleep(500);
  }
  return false;
}

interface Row {
  scene: string;
  bands: string;
  woke: string;
  saved: string;
  outcome: string;
  ok: boolean;
}
const row = (scene: string, ticks: Tick[], ok: boolean, outcome: string): Row => ({
  scene,
  bands: bandsOf(ticks),
  woke: wakingsOf(ticks).map((w) => `${w.by} (${w.strength} against depth ${w.depth})`).join("; ") || "nothing",
  saved: made(ticks) + saved(ticks) > 0 ? `${saved(ticks)} of ${made(ticks) + saved(ticks)}` : "instinct off",
  outcome,
  ok,
});

/** Tired, at night, beside the bed: does it go to bed by itself? */
async function bedtime(scene: string): Promise<Row> {
  const ticks = await play(async () => void (await sleep(25_000)), { awakeDays: 1, before: night() });
  const proposed = ticks.find((t) => ret(t).bedtime?.proposed !== undefined);
  const started = ticks.find((t) => (t.skillEvents ?? []).some((e) => e.skill === "sleep" && e.type === "started"));
  const asleep = firstAsleep(ticks);
  const ok = started?.winner?.region === "reticular" && asleep !== undefined;
  return row(scene, ticks, ok, `sleepy ${level(proposed, "sleepy").toFixed(2)}; bed proposed at ${proposed ? ret(proposed).bedtime!.proposed : "?"} and started by ${started?.winner?.region ?? "nothing"} after ${secondsIn(ticks, started)} s; asleep after ${secondsIn(ticks, asleep)} s; arousal at the end ${ret(ticks.at(-1)!).arousal}`);
}

const scenes: Record<string, () => Promise<Row>> = {
  /** 1. Bedtime, three times over. */
  bedtime1: () => bedtime("bedtime, run 1"),
  bedtime2: () => bedtime("bedtime, run 2"),
  bedtime3: () => bedtime("bedtime, run 3"),

  /** 2. The same scene, having just slept: it stays up. */
  async rested() {
    const ticks = await play(async () => void (await sleep(25_000)), { awakeDays: 0, before: night() });
    const proposals = ticks.filter((t) => ret(t).bedtime?.proposed !== undefined).length;
    const started = events(ticks, "sleep", "started").length;
    return row("not tired: night, but it has just slept", ticks, started === 0 && proposals === 0, `sleepy at most ${Math.max(...ticks.map((t) => level(t, "sleepy"))).toFixed(2)} (bed needs 0.5); bed proposed on ${proposals} ticks; sleep started ${started} times`);
  },

  /** 3. The same far bang early in the night and near morning. */
  async depth() {
    let earlyAt = 0;
    let lateAt = 0;
    const ticks = await play(
      async () => {
        if (!(await untilAsleep(40))) return;
        await sleep(6000);
        earlyAt = Date.now();
        rcon(FAR_BANG);
        await sleep(8000);
        // Near morning: the night is moved on while it sleeps.
        rcon("time set 22400");
        await sleep(5000);
        lateAt = Date.now();
        rcon(FAR_BANG);
        await sleep(8000);
      },
      { awakeDays: 1, before: night(13_000) },
    );
    const around = (at: number) => ticks.filter((t) => at > 0 && t.timestamp >= at && t.timestamp <= at + 4000);
    const startleOf = (window: Tick[]) => Math.max(0, ...window.map((t) => level(t, "startle")));
    const depthAt = (at: number) => [...ticks].reverse().find((t) => at > 0 && t.timestamp <= at && ret(t).depth !== undefined);
    const [early, late] = [around(earlyAt), around(lateAt)];
    const wokeEarly = wakingsOf(early);
    const wokeLate = wakingsOf(late);
    const ok = earlyAt > 0 && startleOf(early) > 0 && wokeEarly.length === 0 && wokeLate.length > 0;
    return row("deep and light: the same far bang early and late", ticks, ok, `early: depth ${depthAt(earlyAt) ? ret(depthAt(earlyAt)!).depth : "?"}, startle ${startleOf(early).toFixed(2)}, woke: ${wokeEarly.map((w) => w.by).join(", ") || "no"}; late: depth ${depthAt(lateAt) ? ret(depthAt(lateAt)!).depth : "?"}, startle ${startleOf(late).toFixed(2)}, woke: ${wokeLate.map((w) => w.by).join(", ") || "no"}`);
  },

  /** 4. Food runs down while asleep: it wakes for the urge and eats before it is hurt. */
  async hungry() {
    let drainedAt = 0;
    const ticks = await play(
      async () => {
        if (!(await untilAsleep(40))) return;
        await sleep(4000);
        drainedAt = Date.now();
        rcon(`effect give ${BOT} hunger 60 255 true`);
        for (let i = 0; i < 100 && !(Number(/(-?\d+)$/.exec(rcon(`data get entity ${BOT} foodLevel`))?.[1] ?? NaN) <= 6); i++) await sleep(200);
        rcon(`effect clear ${BOT}`);
        await sleep(12_000);
      },
      // Food does not run down on peaceful.
      { awakeDays: 1, before: [...night(13_000), "difficulty easy"], give: ["bread 4"] },
    );
    const after = ticks.filter((t) => drainedAt > 0 && t.timestamp >= drainedAt);
    const waking = wakingsOf(after)[0];
    const ate = events(after, "eat", "done").length;
    const lowestHealth = Math.min(...after.map((t) => t.state.data.self.health));
    const lowestFood = Math.min(...after.map((t) => t.state.data.self.food));
    const ok = waking?.by === "urge" && ate > 0 && lowestHealth >= 20;
    rcon("difficulty peaceful");
    return row("hungry asleep: food runs down in bed", ticks, ok, `food down to ${Number.isFinite(lowestFood) ? lowestFood : "?"}; woken by ${waking?.by ?? "NOTHING"}; ate ${ate} time(s); lowest health ${Number.isFinite(lowestHealth) ? lowestHealth : "?"} (20 is unhurt)`);
  },

  /** 5. Dawn: the game stops allowing sleep a little before the bot's clock says day. */
  async dawn() {
    const ticks = await play(async () => void (await sleep(30_000)), { awakeDays: 1, before: night(23_480) });
    const started = events(ticks, "sleep", "started").length;
    const refused = events(ticks, "sleep", "failed");
    const waiting = ticks.filter((t) => ret(t).bedtime?.delayed?.includes("refused") || ret(t).bedtime?.delayed === "sleep was refused a moment ago").length;
    return row("dawn: too late to sleep", ticks, started <= 2, `sleep started ${started} time(s), refused ${refused.length} (${[...new Set(refused.map((e) => e.reason ?? "no reason"))].join("; ") || "never"}); held off on ${waiting} ticks after a refusal; every delay: ${[...new Set(ticks.flatMap((t) => ret(t).bedtime?.delayed ?? []).map((d) => d.replace(/waiting \d+ s/, "waiting")))].join("; ") || "none"}`);
  },

  /** 6. Tired at night with no bed in reach: arousal and the gate sink, calls are saved; a hostile brings it straight back. */
  async nobed() {
    buildPlaza();
    for (const command of ["kill @e[type=!player,x=60,y=151,z=40,distance=..60]", "fill 40 151 36 80 160 44 air", "fill 40 149 36 80 150 44 stone"]) rcon(command);
    let huskAt = 0;
    const ticks = await play(
      async () => {
        await sleep(75_000);
        rcon("difficulty easy");
        huskAt = Date.now();
        rcon("summon husk 66.5 151 40.5");
        await sleep(6000);
        rcon("kill @e[type=husk]");
      },
      { at: PLAZA, awakeDays: 2.5, regions: ALL, before: night() },
    );
    rcon("difficulty peaceful");
    const before = ticks.filter((t) => t.timestamp < huskAt);
    const after = ticks.filter((t) => huskAt > 0 && t.timestamp >= huskAt);
    const lowest = Math.min(...before.map((t) => ret(t).arousal ?? 1));
    const lowestRate = Math.min(...before.map((t) => level(t, "upper_rate")));
    const backAt = after.find((t) => level(t, "upper_rate") >= 1);
    const noBed = before.filter((t) => ret(t).bedtime?.delayed === "no bed in reach").length;
    const ok = lowest < 0.35 && saved(before) > 0 && backAt !== undefined && backAt.timestamp - huskAt < 2000 && events(ticks, "sleep", "started").length === 0;
    return row("idle at night with no bed in reach", ticks, ok, `arousal fell to ${lowest.toFixed(2)}, the rate to ${lowestRate.toFixed(2)}; "no bed in reach" on ${noBed} ticks; instinct calls before the husk: ${made(before)} made, ${saved(before)} saved; after it: rate 1 within ${backAt ? backAt.timestamp - huskAt : "?"} ms, ${made(after)} made, ${saved(after)} saved; arousal up to ${Math.max(...after.map((t) => ret(t).arousal ?? 0)).toFixed(2)}`);
  },

  /** 7. A bot that never sleeps, idle and safe by day: quiet rest, and memories are consolidated. */
  async quiet() {
    const ticks = await play(async () => void (await sleep(110_000)), { awakeDays: 3, before: dayTime });
    const quietTick = ticks.find((t) => level(t, "quiet") > 0);
    const sorted = ticks.filter((t) => traceOf(t, "hippocampus").consolidation !== undefined);
    const asleep = ticks.filter((t) => t.state.data.self.asleep).length;
    const ok = quietTick !== undefined && sorted.length > 0 && asleep === 0;
    return row("quiet rest: never sleeps, idle and safe by day", ticks, ok, `arousal fell to ${Math.min(...ticks.map((t) => ret(t).arousal ?? 1)).toFixed(2)}; quiet after ${secondsIn(ticks, quietTick)} s; memories consolidated on ${sorted.length} ticks (${[...new Set(sorted.map((t) => (traceOf(t, "hippocampus").consolidation as { phase: string }).phase))].join(", ") || "none"}); asleep on ${asleep} ticks`);
  },

  /** 8. Several threats at once: how aroused it gets, and what instinct is offered. */
  async frazzled() {
    buildPlaza();
    for (const command of ["kill @e[type=!player,x=60,y=151,z=40,distance=..60]", "fill 40 151 36 80 160 44 air", "fill 40 149 36 80 150 44 stone"]) rcon(command);
    let swarmAt = 0;
    const ticks = await play(
      async () => {
        await sleep(8000);
        rcon("difficulty easy");
        swarmAt = Date.now();
        for (const at of ["64.5 151 40.5", "56.5 151 40.5", "60.5 151 43.5"]) rcon(`summon husk ${at}`);
        await sleep(15_000);
        rcon("kill @e[type=husk]");
      },
      { at: PLAZA, regions: ALL, jev: true, before: dayTime },
    );
    rcon("difficulty peaceful");
    const offered = (window: Tick[]) => window.flatMap((t) => { const n = t.regions.find((r) => r.region === "instinct")?.proposals.length ?? 0; return traceOf(t, "instinct").engine !== undefined ? [n] : []; });
    const mean = (ns: number[]) => (ns.length ? (ns.reduce((a, b) => a + b, 0) / ns.length).toFixed(1) : "none");
    const calm = ticks.filter((t) => t.timestamp < swarmAt);
    const frazzledTicks = ticks.filter((t) => level(t, "frazzled") > 0);
    const peak = Math.max(...ticks.map((t) => ret(t).arousal ?? 0));
    const ok = frazzledTicks.length > 0 && Math.max(0, ...offered(frazzledTicks)) <= 2;
    return row("frazzled: three husks at once", ticks, ok, `arousal peaked at ${peak.toFixed(2)}; frazzled on ${frazzledTicks.length} ticks; instinct offered on average ${mean(offered(calm))} options when calm (most ${Math.max(0, ...offered(calm))}) and ${mean(offered(frazzledTicks))} when frazzled (most ${Math.max(0, ...offered(frazzledTicks))}); planner offline on ${frazzledTicks.filter((t) => level(t, "planner_offline") > 0).length} of those ticks; health at the end ${ticks.at(-1)!.state.data.self.health}`);
  },
};

const wanted = process.argv.slice(2);
const rows: Row[] = [];
try {
  for (const [name, run] of Object.entries(scenes)) {
    if (wanted.length && !wanted.includes(name)) continue;
    console.log(`=== ${name}`);
    const result = await run().catch((error: unknown): Row => ({ scene: name, bands: "", woke: "", saved: "", outcome: `ERROR: ${error instanceof Error ? error.message : error}`, ok: false }));
    rows.push(result);
    console.log(`    ${result.ok ? "ok" : "NOT ok"}: ${result.outcome}`);
  }
} finally {
  for (const command of ["kill @e[type=husk]", "difficulty peaceful", "gamerule players_sleeping_percentage 100", "time set 1000"]) rcon(command);
}

const table = [["scene", "bands visited", "what woke it", "calls saved", "ok"], ...rows.map((r) => [r.scene, r.bands, r.woke, r.saved, r.ok ? "yes" : "NO"])];
const widths = table[0]!.map((_, c) => Math.max(...table.map((r) => r[c]!.length)));
console.log("");
for (const [i, r] of table.entries()) {
  console.log(r.map((cell, c) => cell.padEnd(widths[c]!)).join(" | "));
  if (i === 0) console.log(widths.map((w) => "-".repeat(w)).join("-|-"));
}
const failed = rows.filter((r) => !r.ok);
console.log(failed.length ? `\nFAIL: ${failed.map((r) => r.scene).join(", ")}` : `\nPASS: all ${rows.length} scenes.`);
process.exit(failed.length ? 1 : 0);
